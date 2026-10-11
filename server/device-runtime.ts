/**
 * CP-11: single server-owned source, staged health verification, atomic revision
 * transitions. The browser cannot construct device sockets or issue Modbus writes.
 */
import {ModbusTcpReadAdapter,type AdapterHealth,type ReadOnlyAdapter}
 from './adapters/modbus-tcp.ts';
import {validateModbusConfig,type ModbusConfig} from '../src/shared/modbus-mapping.ts';
import type {TagHub} from './tag-hub.ts';

export type AdapterFactory=(config:ModbusConfig,
 emit:(sample:import('../src/shared/tag-protocol.ts').WireSample)=>void,
 health:(value:AdapterHealth)=>void)=>ReadOnlyAdapter;
export interface DeviceState {
 readonly revision:number;
 readonly health:AdapterHealth|'UNCONFIGURED';
 readonly configured:boolean;
 readonly config:Required<ModbusConfig>|null;
 readonly busy:boolean;
}
export class DeviceRuntime {
 private current:ReadOnlyAdapter|null=null;
 private config:Required<ModbusConfig>|null=null;
 private revision=0;
 private health:DeviceState['health']='UNCONFIGURED';
 private busy=false;
 private closed=false;
 private readonly hub:TagHub;
 private readonly adapterFactory:AdapterFactory;
 private readonly persist:(config:Required<ModbusConfig>)=>void;
 constructor(hub:TagHub,
  adapterFactory:AdapterFactory=(c,emit,health)=>
    new ModbusTcpReadAdapter(c,emit,health),
  persist:(config:Required<ModbusConfig>)=>void=()=>{}){
  this.hub=hub;this.adapterFactory=adapterFactory;this.persist=persist;
 }
 snapshot():DeviceState{
  return {revision:this.revision,health:this.health,
    configured:this.config!==null,config:this.config,busy:this.busy};
 }
 /** Existing startup source follows the same revision/sequence rules. */
 startInitial(config:ModbusConfig):void{
  if(this.closed||this.current)throw Error('Runtime already initialized');
  const safe=validateModbusConfig(config);
  this.config=safe;
  this.health='CONNECTING';
  this.current=this.make(safe);
  this.current.start();
 }
 private make(config:Required<ModbusConfig>):ReadOnlyAdapter {
  return this.adapterFactory(config,s=>this.hub.publish(s),v=>{this.health=v;});
 }
 /**
  * A probe must finish one successful read cycle before stopping a healthy
  * device. Separate socket avoids accidental teardown on validation failure.
  */
 private async probe(config:Required<ModbusConfig>,timeoutMs:number):Promise<void>{
  let finish:(err?:Error)=>void=()=>{};
  let timer:ReturnType<typeof setTimeout>|undefined;
  const checked=new Promise<void>((resolve,reject)=>{
   let settled=false;
   finish=(err?:Error)=>{
    if(settled)return;
    settled=true;
    if(timer!==undefined)clearTimeout(timer);
    if(err)reject(err);else resolve();
   };
   timer=setTimeout(()=>finish(Error('Device probe timed out')),timeoutMs);
  });
  const adapter=this.adapterFactory(config,()=>{},status=>{
    if(status==='HEALTHY')finish();
  });
  try{
   adapter.start();
   await checked;
  }finally{
   await adapter.stop();
  }
 }
 async apply(input:ModbusConfig,expectedRevision:number):Promise<DeviceState>{
  if(this.closed)throw Error('Device runtime stopped');
  if(this.busy)throw Error('Another configuration apply is in progress');
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==this.revision)
   throw Error('Configuration revision conflict');
  const next=validateModbusConfig(input);
  this.busy=true;
  try{
   // A failed candidate leaves existing acquisition untouched.
   await this.probe(next,Math.min(12000,Math.max(1500,next.requestTimeoutMs*
     (2+next.tags.length))));
   if(this.closed)throw Error('Runtime stopped during probe');
   this.persist(next);
   const previous=this.current;
   try{
    await previous?.stop();
    this.hub.stopDemo();
    this.hub.resetSource('MODBUS_TCP');
    const incoming=this.make(next);
    this.current=incoming;
    this.config=next;
    this.health='CONNECTING';
    this.revision++;
    incoming.start();
   }catch(error){
    // Should the activation step fail unexpectedly, reinstate prior source.
    if(previous&&this.config!==next){
     this.current=previous;
     previous.start();
    }
    throw error;
   }
   return {...this.snapshot(),busy:false};
  }finally{this.busy=false;}
 }
 async stop():Promise<void>{
  this.closed=true;
  await this.current?.stop();
  this.current=null;
 }
}
