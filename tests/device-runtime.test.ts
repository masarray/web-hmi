import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createTagHub} from '../server/tag-hub.ts';
import {DeviceRuntime,type AdapterFactory} from '../server/device-runtime.ts';
import {createDeviceConfigHandler} from '../server/device-config-api.ts';
import {validateModbusConfig,type ModbusConfig} from '../src/shared/modbus-mapping.ts';
import type {WireSample} from '../src/shared/tag-protocol.ts';
import type {AdapterHealth,ReadOnlyAdapter} from '../server/adapters/modbus-tcp.ts';

const TOKEN='node-ci-device-config-admin-token-32chars!';
const ORIGIN='http://127.0.0.1:4200';
const CONFIG:ModbusConfig={host:'127.0.0.1',port:502,unitId:1,pollMs:200,
 requestTimeoutMs:100,tags:[{tagId:'Plant/Motor',functionCode:3,address:0}]};
function fakeAdapter(healthy:(config:ModbusConfig)=>boolean=()=>true,
 counter={started:0,stopped:0}):AdapterFactory {
 return (config,emit,health)=>{
  let started=false;
  return {
   start(){
    started=true;counter.started++;
    health('CONNECTING');
    if(healthy(config)){
     emit({tagId:config.tags[0]!.tagId,value:1,quality:'GOOD',sequence:1});
     health('HEALTHY');
    }else health('DEGRADED');
   },
   async stop(){if(started)counter.stopped++;started=false;health('DISCONNECTED');},
   status():AdapterHealth{return started?'HEALTHY':'DISCONNECTED';}
  };
 };
}
async function server(factory:AdapterFactory=fakeAdapter(),
 persist:(cfg:Required<ModbusConfig>)=>void=()=>{}){
 const hub=createTagHub({demo:false,heartbeatMs:200});
 const runtime=new DeviceRuntime(hub,factory,persist);
 hub.setControlHandler(createDeviceConfigHandler(runtime,{
  token:TOKEN,origins:[ORIGIN]
 }));
 await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
 const address=hub.http.address();
 if(!address||typeof address==='string')throw Error('No test port');
 const url='http://127.0.0.1:'+address.port;
 return {url,hub,runtime,async close(){await runtime.stop();await hub.close();}};
}
function call(url:string,path:string,options:{
 token?:string;origin?:string;method?:string;json?:unknown
}={}){
 return fetch(url+path,{
  method:options.method??'GET',
  headers:{origin:options.origin??ORIGIN,
   ...(options.token===undefined?{}:{Authorization:'Bearer '+options.token}),
   ...(options.json===undefined?{}:{'Content-Type':'application/json'})},
  ...(options.json===undefined?{}:{body:JSON.stringify(options.json)})
 });
}
test('admin endpoints fail closed: wrong token, wrong Origin, unknown command and disabled default',async()=>{
 const s=await server();
 try{
  assert.equal((await call(s.url,'/api/device/status')).status,401);
  assert.equal((await call(s.url,'/api/device/status',{token:'bad-token'})).status,401);
  assert.equal((await call(s.url,'/api/device/status',{token:TOKEN,
   origin:'https://evil.example'})).status,403);
  assert.equal((await call(s.url,'/api/device/write',{token:TOKEN,method:'POST'})).status,404);
  const response=await call(s.url,'/api/device/status',{token:TOKEN});
  assert.equal(response.status,200);
  assert.equal((await response.json()).configured,false);
  const preflight=await call(s.url,'/api/device/apply',{method:'OPTIONS'});
  assert.equal(preflight.status,204);
 }finally{await s.close();}
 const hub=createTagHub({demo:false});
 await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
 try{
  const address=hub.http.address();
  if(!address||typeof address==='string')throw Error('No port');
  const r=await fetch('http://127.0.0.1:'+address.port+'/api/device/status');
  assert.equal(r.status,404); // no admin token means no admin endpoints
 }finally{await hub.close();}
});
test('verified candidate activates, increments revision, resets cache and rejects stale operators',async()=>{
 let saved:Required<ModbusConfig>|null=null;
 const counts={started:0,stopped:0};
 const s=await server(fakeAdapter(()=>true,counts),cfg=>{saved=cfg;});
 const socket=new WebSocket(s.url.replace('http','ws')+'/ws/tags',{origin:ORIGIN});
 const received:any[]=[];
 socket.on('message',b=>received.push(JSON.parse(b.toString())));
 try{
  await once(socket,'open');
  socket.send(JSON.stringify({type:'subscribe',version:1,tags:['Plant/Motor']}));
  const posted=await call(s.url,'/api/device/apply',{token:TOKEN,method:'POST',
   json:{revision:0,config:CONFIG}});
  assert.equal(posted.status,200);
  const active=await posted.json();
  assert.equal(active.revision,1);assert.equal(active.configured,true);
  assert.equal(active.busy,false);
  assert.equal((saved as Required<ModbusConfig>|null)?.host,'127.0.0.1');
  assert.equal(counts.started,2); // candidate probe + activated source
  const duplicate=await call(s.url,'/api/device/apply',{token:TOKEN,method:'POST',
   json:{revision:0,config:CONFIG}});
  assert.equal(duplicate.status,409);
  assert.equal(s.runtime.snapshot().revision,1);
  const end=Date.now()+1000;
  while(!received.some(x=>x.type==='source-reset')&&Date.now()<end)
   await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(received.some(x=>x.type==='source-reset'&&x.source==='MODBUS_TCP'));
  assert.equal((await (await fetch(s.url+'/health')).json()).source,'MODBUS_TCP');
 }finally{socket.terminate();await s.close();}
});
test('bad candidate and disk failure do not tear down healthy acquisition',async()=>{
 const counts={started:0,stopped:0};
 const factory=fakeAdapter(cfg=>cfg.port!==1111,counts);
 const s=await server(factory,cfg=>{if(cfg.port===2222)throw Error('disk full');});
 try{
  s.runtime.startInitial(CONFIG);
  assert.equal(s.runtime.snapshot().health,'HEALTHY');
  let result=await call(s.url,'/api/device/apply',{token:TOKEN,method:'POST',
   json:{revision:0,config:{...CONFIG,port:1111}}});
  assert.equal(result.status,400);
  assert.equal(s.runtime.snapshot().revision,0);
  assert.equal(s.runtime.snapshot().health,'HEALTHY');
  assert.equal(counts.stopped,1); // only unsuccessful probe was stopped
  result=await call(s.url,'/api/device/apply',{token:TOKEN,method:'POST',
   json:{revision:0,config:{...CONFIG,port:2222}}});
  assert.equal(result.status,400);
  assert.equal(s.runtime.snapshot().health,'HEALTHY');
  assert.equal(s.runtime.snapshot().revision,0);
  assert.equal(counts.stopped,2); // only probe sockets closed
 }finally{await s.close();}
});
test('oversized body and invalid/no write mapping cannot change active source',async()=>{
 const s=await server();
 try{
  for(const json of [
   {revision:0,config:{...CONFIG,tags:[{tagId:'X',functionCode:6,address:0}]}},
   {revision:0,config:{...CONFIG,host:'http://192.168.1.1'}},
   {revision:0,config:{...CONFIG,tags:[{tagId:'X',functionCode:3,address:65536}]}}
  ]){
   assert.equal((await call(s.url,'/api/device/apply',
    {token:TOKEN,method:'POST',json})).status,400);
  }
  const response=await call(s.url,'/api/device/apply',{token:TOKEN,method:'POST',
   json:{revision:0,config:{...CONFIG,padding:'a'.repeat(50000)}}});
  assert.equal(response.status,400);
  assert.equal(s.runtime.snapshot().revision,0);
 }finally{await s.close();}
});
