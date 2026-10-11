/**
 * CP-13 multi-device runtime: 1 Modbus poller per PLC, 1 shared WebSocket hub.
 * No per-browser device connections. Unchanged PLCs survive a fleet edit.
 */
import {ModbusTcpReadAdapter,type AdapterHealth,type AdapterDiagnostics,
 type ReadOnlyAdapter} from './adapters/modbus-tcp.ts';
import type {AdapterFactory} from './device-runtime.ts';
import {planReads} from '../src/shared/modbus-mapping.ts';
import {qualifiedTag,validateFleet,type FleetDevice,type FleetConfig}
 from '../src/shared/device-fleet.ts';
import type {WireSample} from '../src/shared/tag-protocol.ts';
import type {TagHub} from './tag-hub.ts';

interface Running {
 readonly device:FleetDevice;
 readonly adapter:ReadOnlyAdapter;
 readonly state:{health:AdapterHealth};
}
export interface FleetStatus {
 readonly revision:number;
 readonly busy:boolean;
 readonly devices:readonly (FleetDevice & {
  health:AdapterHealth|'UNCONFIGURED';diagnostics:AdapterDiagnostics|null;
 })[];
}
export type FleetSave=(config:FleetConfig,revision:number)=>void;
export class DeviceFleetRuntime {
 private readonly entries=new Map<string,Running>();
 private readonly sequence=new Map<string,number>();
 private revision=0;
 private busy=false;
 private closed=false;
 private active=false;
 private readonly hub:TagHub;
 private readonly factory:AdapterFactory;
 private readonly save:FleetSave;
 private readonly releaseLegacy:()=>Promise<void>;
 constructor(hub:TagHub,
  factory:AdapterFactory=(cfg,emit,health)=>new ModbusTcpReadAdapter(cfg,emit,health),
  save:FleetSave=()=>{},releaseLegacy:()=>Promise<void>=async()=>{}){
  this.hub=hub;this.factory=factory;this.save=save;this.releaseLegacy=releaseLegacy;
 }
 isActive():boolean{return this.active;}
 snapshot():FleetStatus{
  return {revision:this.revision,busy:this.busy,devices:[...this.entries.values()].map(e=>({
   ...e.device,health:e.state.health,diagnostics:e.adapter.diagnostics?.()??null
  }))};
 }
 private publish(id:string,sample:WireSample):void{
  if(this.closed)return;
  const tagId=qualifiedTag(id,sample.tagId);
  const sequence=(this.sequence.get(tagId)??0)+1;
  this.sequence.set(tagId,sequence);
  this.hub.publish({...sample,tagId,sequence});
 }
 private invalidate(device:FleetDevice):void{
  for(const tag of device.config.tags){
   this.publish(device.id,{tagId:tag.tagId,value:null,quality:'BAD',sequence:0});
  }
 }
 private spawn(device:FleetDevice):Running{
  const state:{health:AdapterHealth}={health:'CONNECTING'};
  const adapter=this.factory(device.config,s=>this.publish(device.id,s),
   health=>{state.health=health;});
  return {device,adapter,state};
 }
 private async probe(device:FleetDevice):Promise<void>{
  let resolveProbe:(error?:Error)=>void=()=>{};
  let timer:ReturnType<typeof setTimeout>|undefined;
  const done=new Promise<void>((resolve,reject)=>{
   let settled=false;
   resolveProbe=error=>{
    if(settled)return;
    settled=true;
    if(timer)clearTimeout(timer);
    error?reject(error):resolve();
   };
   timer=setTimeout(()=>resolveProbe(Error('PLC did not complete a read cycle')),
    Math.min(12000,Math.max(1500,(device.config.requestTimeoutMs??800)*
     (2+planReads(device.config.tags).length))));
  });
  const candidate=this.factory(device.config,()=>{},health=>{
   if(health==='HEALTHY')resolveProbe();
  });
  try{candidate.start();await done;}finally{await candidate.stop();}
 }
 /** Startup restores saved fleet, preserving one poll loop per device. */
 restore(value:unknown,revision=0):void{
  if(this.active||this.closed||!Number.isSafeInteger(revision)||revision<0)
   throw Error('Invalid fleet restore');
  const fleet=validateFleet(value);
  this.active=true;this.revision=revision;
  for(const device of fleet.devices){
   const running=this.spawn(device);this.entries.set(device.id,running);running.adapter.start();
  }
 }
 async testDevice(raw:unknown):Promise<{ok:true;latencyMs:number;readRequests:number}>{
  if(this.closed||this.busy)throw Error('Device manager busy');
  const device=validateFleet({devices:[raw]}).devices[0]!;
  this.busy=true;
  try{
   const start=Date.now();await this.probe(device);
   return {ok:true,latencyMs:Date.now()-start,
    readRequests:planReads(device.config.tags).length};
  }finally{this.busy=false;}
 }
 async apply(value:unknown,expectedRevision:number):Promise<FleetStatus>{
  if(this.closed||this.busy)throw Error('Device manager busy');
  if(expectedRevision!==this.revision||!Number.isSafeInteger(expectedRevision))
   throw Error('Fleet revision conflict');
  const fleet=validateFleet(value);
  const proposed=new Map(fleet.devices.map(d=>[d.id,d] as const));
  const changed=fleet.devices.filter(d=>{
   const old=this.entries.get(d.id);
   return !old||JSON.stringify(old.device.config)!==JSON.stringify(d.config);
  });
  const removed=[...this.entries.values()].filter(e=>
   !proposed.has(e.device.id) || changed.some(d=>d.id===e.device.id));
  this.busy=true;
  try{
   // Check all new/changed PLCs, at most three concurrent network probes.
   let cursor=0;
   const workers=Array.from({length:Math.min(3,changed.length)},async()=>{
    for(;;){
     const index=cursor++;
     if(index>=changed.length)return;
     await this.probe(changed[index]!);
    }
   });
   await Promise.all(workers);
   if(this.closed)throw Error('Device manager stopped during verification');
   this.save(fleet,this.revision+1);
   if(!this.active){
    await this.releaseLegacy();
    this.hub.stopDemo();
    this.hub.resetSource('MODBUS_TCP');
    this.active=true;
   }
   for(const old of removed){
    await old.adapter.stop();
    this.entries.delete(old.device.id);
    this.invalidate(old.device);
   }
   for(const device of changed){
    const current=this.spawn(device);
    this.entries.set(device.id,current);
    current.adapter.start();
   }
   // Rename metadata without disconnecting a working PLC.
   for(const device of fleet.devices){
    if(changed.some(d=>d.id===device.id))continue;
    const running=this.entries.get(device.id);
    if(running&&running.device.name!==device.name)
      this.entries.set(device.id,{...running,device});
   }
   this.revision++;
   return {...this.snapshot(),busy:false};
  }finally{this.busy=false;}
 }
 async stop():Promise<void>{
  this.closed=true;
  await Promise.all([...this.entries.values()].map(e=>e.adapter.stop()));
  this.entries.clear();
 }
}
