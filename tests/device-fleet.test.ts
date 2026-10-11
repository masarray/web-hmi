import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createTagHub} from '../server/tag-hub.ts';
import {DeviceRuntime,type AdapterFactory} from '../server/device-runtime.ts';
import {DeviceFleetRuntime} from '../server/device-fleet-runtime.ts';
import {createDeviceConfigHandler} from '../server/device-config-api.ts';
import {validateFleet,qualifiedTag} from '../src/shared/device-fleet.ts';
import type {FleetDevice} from '../src/shared/device-fleet.ts';
import type {ModbusConfig} from '../src/shared/modbus-mapping.ts';
import type {WireSample} from '../src/shared/tag-protocol.ts';
import type {AdapterHealth} from '../server/adapters/modbus-tcp.ts';

const TOKEN='cp13-multi-device-admin-token-32-chars';
const ORIGIN='http://127.0.0.1:4200';
const cfg=(port:number):ModbusConfig=>({
 host:'10.10.0.1',port,unitId:1,pollMs:100,
 tags:[{tagId:'Motor/Run',functionCode:3,address:0}]
});
const device=(id:string,port:number):FleetDevice=>({id,name:id,config:cfg(port)});
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
async function wait(check:()=>boolean,timeout=1600){
 const end=Date.now()+timeout;
 while(Date.now()<end){if(check())return;await sleep(10);}
 throw Error('Fleet test condition timed out');
}
function harness(fails:(cfg:ModbusConfig)=>boolean=()=>false){
 const started=new Map<number,number>(),stopped=new Map<number,number>();
 const factory:AdapterFactory=(config,emit,health)=>{
  let running=false;
  const port=config.port;
  return {
   start(){
    running=true;started.set(port,(started.get(port)??0)+1);
    health('CONNECTING');
    if(fails(config)){health('DEGRADED');return;}
    emit({tagId:config.tags[0]!.tagId,value:port,quality:'GOOD',sequence:1});
    health('HEALTHY');
   },
   async stop(){
    if(running)stopped.set(port,(stopped.get(port)??0)+1);
    running=false;health('DISCONNECTED');
   },
   status():AdapterHealth{return running?'HEALTHY':'DISCONNECTED';}
  };
 };
 return {factory,started,stopped};
}
async function start(fails:(cfg:ModbusConfig)=>boolean=()=>false){
 const h=harness(fails),hub=createTagHub({demo:false,heartbeatMs:200});
 const legacy=new DeviceRuntime(hub,h.factory);
 let saves=0;
 const fleet=new DeviceFleetRuntime(hub,h.factory,()=>{saves++;},()=>legacy.stop());
 hub.setControlHandler(createDeviceConfigHandler(legacy,{
  token:TOKEN,origins:[ORIGIN]
 },fleet));
 await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
 const address=hub.http.address();
 if(!address||typeof address==='string')throw Error('No port');
 const base='http://127.0.0.1:'+address.port;
 const call=(path:string,method='GET',body?:unknown,token=TOKEN,origin=ORIGIN)=>
  fetch(base+path,{method,
   headers:{Origin:origin,Authorization:'Bearer '+token,
    ...(body===undefined?{}:{'Content-Type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {hub,legacy,fleet,base,call,h,get saves(){return saves;},
  async close(){await fleet.stop();await legacy.stop();await hub.close();}};
}
test('fleet config qualifies identical tag names and rejects collisions and overflow',()=>{
 const valid=validateFleet({devices:[device('PLC1',5501),device('PLC2',5502)]});
 assert.equal(valid.devices.length,2);
 assert.equal(qualifiedTag('PLC1','Motor/Run'),'PLC1/Motor/Run');
 assert.throws(()=>validateFleet({devices:[device('PLC1',5501),device('PLC1',5502)]}));
 assert.throws(()=>validateFleet({devices:[device('A/B',5501)]}));
 assert.throws(()=>validateFleet({devices:[{...device('PLC1',5501),name:'  '}]}));
 assert.throws(()=>validateFleet({devices:Array.from({length:17},(_,i)=>device('PLC'+i,5501+i))}));
 assert.throws(()=>validateFleet({devices:[{
  id:'PLC1',name:'PLC',config:{...cfg(5501),tags:[{tagId:'X'.repeat(158),functionCode:3,address:0}]}
 }]}));
});
test('two PLC sources share one WebSocket while identical tag IDs stay independent',async()=>{
 const s=await start();
 const ws=new WebSocket(s.base.replace('http','ws')+'/ws/tags',{origin:ORIGIN});
 const seen:any[]=[];
 ws.on('message',data=>seen.push(JSON.parse(data.toString())));
 try{
  await once(ws,'open');
  ws.send(JSON.stringify({type:'subscribe',version:1,
   tags:['PLC1/Motor/Run','PLC2/Motor/Run']}));
  await wait(()=>seen.some(x=>x.type==='subscribed'));
  const response=await s.call('/api/fleet/apply','POST',{
   revision:0,devices:[device('PLC1',5501),device('PLC2',5502)]
  });
  assert.equal(response.status,200,await response.text().catch(()=>''));
  await wait(()=>seen.some(x=>x.type==='sample'&&x.sample.tagId==='PLC1/Motor/Run'&&
   x.sample.value===5501)&&seen.some(x=>x.type==='sample'&&
   x.sample.tagId==='PLC2/Motor/Run'&&x.sample.value===5502));
  assert.equal(s.hub.metrics().clients,1);
  assert.equal(s.fleet.snapshot().devices.length,2);
  assert.equal(s.fleet.snapshot().revision,1);
  assert.equal(s.saves,1);
  assert.equal(s.h.started.get(5501),2); // candidate and live only
  assert.equal(s.h.started.get(5502),2);
  const fleetResponse=await s.call('/api/fleet');
  assert.equal(fleetResponse.status,200);
  const list=await fleetResponse.json();
  assert.deepEqual(list.devices.map((d:{id:string})=>d.id),['PLC1','PLC2']);
  const legacyResult=await s.call('/api/device/apply','POST',{revision:0,config:cfg(5503)});
  assert.equal(legacyResult.status,409);
 }finally{ws.terminate();await s.close();}
});
test('update only one PLC, retain others on failed candidate, rename without reconnect',async()=>{
 const s=await start(c=>c.port===6600);
 try{
  assert.equal((await s.call('/api/fleet/apply','POST',{
   revision:0,devices:[device('PLC1',5501),device('PLC2',5502)]
  })).status,200);
  const before=s.h.started.get(5502);
  const failed=await s.call('/api/fleet/apply','POST',{
   revision:1,devices:[device('PLC1',6600),device('PLC2',5502)]
  });
  assert.equal(failed.status,400);
  assert.equal(s.fleet.snapshot().revision,1);
  assert.equal(s.h.stopped.get(5501),1); // initial probe only
  assert.equal(s.h.started.get(5502),before);
  assert.equal(s.saves,1);
  const rename=await s.call('/api/fleet/apply','POST',{
   revision:1,devices:[{...device('PLC1',5501),name:'Boiler PLC'},device('PLC2',5502)]
  });
  assert.equal(rename.status,200);
  assert.equal(s.h.started.get(5501),2); // rename requires no probe or reconnect
  assert.equal(s.h.started.get(5502),before);
  assert.equal(s.fleet.snapshot().devices[0]?.name,'Boiler PLC');
  const update=await s.call('/api/fleet/apply','POST',{
   revision:2,devices:[device('PLC1',5503),device('PLC2',5502)]
  });
  assert.equal(update.status,200);
  assert.equal(s.h.started.get(5503),2);
  assert.equal(s.h.started.get(5502),before);
  assert.equal(s.fleet.snapshot().revision,3);
  const stale=await s.call('/api/fleet/apply','POST',{
   revision:2,devices:[device('PLC1',5503)]
  });
  assert.equal(stale.status,409);
 }finally{await s.close();}
});
test('deleting PLC marks only its tags BAD and does not interrupt other device',async()=>{
 const s=await start();
 const ws=new WebSocket(s.base.replace('http','ws')+'/ws/tags',{origin:ORIGIN});
 const seen:any[]=[];
 ws.on('message',raw=>seen.push(JSON.parse(raw.toString())));
 try{
  await once(ws,'open');
  ws.send(JSON.stringify({type:'subscribe',version:1,
    tags:['PLC1/Motor/Run','PLC2/Motor/Run']}));
  await wait(()=>seen.some(x=>x.type==='subscribed'));
  assert.equal((await s.call('/api/fleet/apply','POST',{
   revision:0,devices:[device('PLC1',5501),device('PLC2',5502)]
  })).status,200);
  const before=s.h.stopped.get(5502)??0;
  const remove=await s.call('/api/fleet/apply','POST',{
   revision:1,devices:[device('PLC2',5502)]
  });
  assert.equal(remove.status,200);
  await wait(()=>seen.some(x=>x.type==='sample'&&
   x.sample.tagId==='PLC1/Motor/Run'&&x.sample.quality==='BAD'));
  assert.equal(s.h.stopped.get(5502)??0,before);
  assert.equal(s.fleet.snapshot().devices[0]?.id,'PLC2');
 }finally{ws.terminate();await s.close();}
});
test('fleet endpoints are admin-authenticated, Origin-gated and reject Modbus write mapping',async()=>{
 const s=await start();
 try{
  assert.equal((await s.call('/api/fleet','GET',undefined,'wrong')).status,401);
  assert.equal((await s.call('/api/fleet','GET',undefined,TOKEN,'https://evil.test')).status,403);
  assert.equal((await s.call('/api/fleet/apply','POST',{
   revision:0,devices:[{...device('PLC1',5501),config:{
    ...cfg(5501),tags:[{tagId:'X',functionCode:6,address:0}]
   }}]
  })).status,400);
  const test=await s.call('/api/fleet/test','POST',{device:device('PLC1',5501)});
  assert.equal(test.status,200);
  assert.equal((await test.json()).readRequests,1);
  assert.equal(s.fleet.snapshot().revision,0);
  assert.equal(s.saves,0);
 }finally{await s.close();}
});
