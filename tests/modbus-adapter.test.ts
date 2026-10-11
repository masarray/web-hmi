import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server,type Socket} from 'node:net';
import WebSocket from 'ws';
import {once} from 'node:events';
import {ModbusTcpReadAdapter,planReads,validateModbusConfig,
 type RegisterTag} from '../server/adapters/modbus-tcp.ts';
import {modbusFromEnvironment} from '../server/adapter-config.ts';
import {createTagHub} from '../server/tag-hub.ts';
import type {WireSample} from '../src/shared/tag-protocol.ts';

type Fault='healthy'|'silent'|'exception'|'drop';
class FakeModbus {
 readonly server:Server;
 readonly connections=new Set<Socket>();
 readonly requests:{fn:number;start:number;count:number}[]=[];
 fault:Fault='healthy';
 fragment=true;
 constructor(){
  this.server=createServer(socket=>{
   this.connections.add(socket);
   socket.on('close',()=>this.connections.delete(socket));
   let buffer=Buffer.alloc(0);
   socket.on('data',data=>{
    buffer=Buffer.concat([buffer,data]);
    while(buffer.length>=7){
     const length=buffer.readUInt16BE(4),size=6+length;
     if(length!==6||buffer.length<size)break;
     const request=buffer.subarray(0,size);buffer=buffer.subarray(size);
     const fn=request[7]!,start=request.readUInt16BE(8),
      count=request.readUInt16BE(10);
     this.requests.push({fn,start,count});
     if(this.fault==='drop'){socket.destroy();continue;}
     if(this.fault==='silent')continue;
     const body=this.fault==='exception'?Buffer.from([fn|0x80,2]):
      Buffer.concat([Buffer.from([fn,count*2]),...Array.from({length:count},(_,i)=>{
       const word=Buffer.alloc(2);word.writeUInt16BE(start+i+100,0);return word;
      })]);
     const response=Buffer.alloc(7+body.length);
     response.writeUInt16BE(request.readUInt16BE(0),0);
     response.writeUInt16BE(0,2);
     response.writeUInt16BE(body.length+1,4);
     response[6]=request[6]!;body.copy(response,7);
     if(this.fragment&&response.length>9){
      socket.write(response.subarray(0,5));
      setTimeout(()=>{if(!socket.destroyed)socket.write(response.subarray(5));},5);
     }else socket.write(response);
    }
   });
  });
 }
 async start():Promise<number>{
  await new Promise<void>(resolve=>this.server.listen(0,'127.0.0.1',resolve));
  const address=this.server.address();
  if(!address||typeof address==='string')throw Error('no port');
  return address.port;
 }
 async stop():Promise<void>{
  for(const socket of this.connections)socket.destroy();
  await new Promise<void>(resolve=>this.server.close(()=>resolve()));
 }
}
const tags:readonly RegisterTag[]=[
 {tagId:'Plant/Motor',functionCode:3,address:0},
 {tagId:'Plant/Gear',functionCode:3,address:1},
 {tagId:'Pump/Pressure',functionCode:4,address:5}
];
const wait=async(fn:()=>boolean,timeoutMs=2500)=>{
 const end=Date.now()+timeoutMs;
 while(Date.now()<end){
  if(fn())return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw Error('Wait for adapter state timed out');
};
const config=(port:number)=>({
 host:'127.0.0.1',port,unitId:1,tags,pollMs:55,
 requestTimeoutMs:95,reconnectMaxMs:180
});

test('CP10 explicit endpoints allow industrial LAN while rejecting unsafe mappings and writes',()=>{
 assert.equal(modbusFromEnvironment({}),null);
 assert.equal(modbusFromEnvironment({HMI_SOURCE:'demo'}),null);
 assert.equal(modbusFromEnvironment({
  HMI_SOURCE:'modbus-tcp',HMI_MODBUS_PORT:'15020',
  HMI_MODBUS_HOST:'192.168.1.10',
  HMI_MODBUS_TAGS:JSON.stringify(tags)
 })?.host,'192.168.1.10');
 assert.throws(()=>modbusFromEnvironment({
  HMI_SOURCE:'modbus-tcp',HMI_MODBUS_PORT:'15020',
  HMI_MODBUS_HOST:'http://192.168.1.10',
  HMI_MODBUS_TAGS:JSON.stringify(tags)
 }),/hostname|address/);
 assert.throws(()=>modbusFromEnvironment({
  HMI_SOURCE:'modbus-lab',HMI_MODBUS_PORT:'15020',
  HMI_MODBUS_TAGS:JSON.stringify([{tagId:'X',functionCode:6,address:0}])
 }),/Invalid or duplicated/);
 assert.throws(()=>validateModbusConfig({...config(502),tags:[
  ...tags,{tagId:'Plant/Motor',functionCode:3,address:20}
 ]}),/duplicated/);
 assert.throws(()=>validateModbusConfig({...config(502),tags:[
  {tagId:'X',functionCode:3,address:65536}
 ]}),/Invalid or duplicated/);
 assert.throws(()=>validateModbusConfig({...config(502),tags:Array.from(
  {length:129},(_,i)=>({tagId:'T'+i,functionCode:3 as const,address:i}))
 }),/tag count/);
 assert.deepEqual(planReads(tags).map(x=>[x.functionCode,x.start,x.count]),[
  [3,0,2],[4,5,1]
 ]);
});
test('FC03+FC04 read coalescing and split TCP responses preserve value mapping',async()=>{
 const server=new FakeModbus();const port=await server.start();
 const samples:WireSample[]=[],health:string[]=[];
 const adapter=new ModbusTcpReadAdapter(config(port),s=>samples.push(s),
  s=>health.push(s));
 try{
  adapter.start();
  await wait(()=>tags.every(t=>samples.some(s=>s.tagId===t.tagId&&s.quality==='GOOD')));
  const latest=(id:string)=>samples.find(s=>s.tagId===id&&s.quality==='GOOD')!;
  assert.equal(latest('Plant/Motor').value,100);
  assert.equal(latest('Plant/Gear').value,101);
  assert.equal(latest('Pump/Pressure').value,105);
  assert.deepEqual(server.requests.slice(0,2),[
   {fn:3,start:0,count:2},{fn:4,start:5,count:1}
  ]);
  assert.ok(health.includes('HEALTHY'));
 }finally{await adapter.stop();await server.stop();}
 assert.equal(adapter.status(),'DISCONNECTED');
});
test('timeout BAD, bounded reconnect and fresh GOOD recovery without restarting adapter',async()=>{
 const server=new FakeModbus(),port=await server.start();
 server.fault='silent';
 const messages:WireSample[]=[],transitions:string[]=[];
 const adapter=new ModbusTcpReadAdapter(config(port),s=>messages.push(s),
  s=>transitions.push(s));
 try{
  adapter.start();
  await wait(()=>transitions.includes('DEGRADED'));
  assert.ok(messages.some(s=>s.quality==='BAD'&&s.value===null));
  const maxSequence=Math.max(...messages.map(s=>s.sequence));
  server.fault='healthy';
  await wait(()=>adapter.status()==='HEALTHY'&&messages.some(s=>
   s.quality==='GOOD'&&s.sequence>maxSequence));
  assert.ok(messages.some(s=>s.quality==='GOOD'&&s.tagId==='Plant/Motor'));
 }finally{await adapter.stop();await server.stop();}
});
test('Modbus exception is BAD; disconnect/stop cancels in-flight IO',async()=>{
 const server=new FakeModbus(),port=await server.start();
 server.fault='exception';
 const seen:WireSample[]=[];
 const adapter=new ModbusTcpReadAdapter(config(port),s=>seen.push(s));
 try{
  adapter.start();
  await wait(()=>seen.some(s=>s.quality==='BAD'));
  server.fault='drop';
  await wait(()=>server.requests.length>=2);
  const before=Date.now();
  await adapter.stop();
  assert.ok(Date.now()-before<600);
  assert.equal(adapter.status(),'DISCONNECTED');
 }finally{await adapter.stop();await server.stop();}
});
test('one hardware polling loop fans out through hub to two subscribed WebSocket clients',async()=>{
 const device=new FakeModbus(),port=await device.start();
 const hub=createTagHub({demo:false,source:'MODBUS_LAB',heartbeatMs:200});
 await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
 const addr=hub.http.address();
 if(!addr||typeof addr==='string')throw Error('hub port missing');
 const url='ws://127.0.0.1:'+addr.port+'/ws/tags';
 const clients:WebSocket[]=[],seen:Record<string,unknown>[][]=[];
 const adapter=new ModbusTcpReadAdapter(config(port),sample=>hub.publish(sample));
 try{
  for(let i=0;i<2;i++){
   const socket=new WebSocket(url,{origin:'http://127.0.0.1:4200'});
   const messages:Record<string,unknown>[]=[];
   socket.on('message',raw=>{
    try{messages.push(JSON.parse(raw.toString()) as Record<string,unknown>);}catch{}
   });
   clients.push(socket);seen.push(messages);
   await once(socket,'open');
   socket.send(JSON.stringify({type:'subscribe',version:1,tags:['Plant/Motor']}));
  }
  await wait(()=>seen.every(row=>row.some(x=>x.type==='subscribed')));
  adapter.start();
  await wait(()=>seen.every(row=>row.some(x=>
   x.type==='sample'&&(x.sample as WireSample)?.quality==='GOOD')));
  assert.equal(hub.metrics().subscriptions,2);
  assert.equal(hub.metrics().clients,2);
  // Polling work must depend on mapped registers, never browser count.
  assert.deepEqual(device.requests.slice(0,2),[
   {fn:3,start:0,count:2},{fn:4,start:5,count:1}
  ]);
  const hello=seen[0]!.find(x=>x.type==='hello');
  assert.equal(hello?.source,'MODBUS_LAB');
 }finally{
  await adapter.stop();
  for(const s of clients)s.terminate();
  await hub.close();
  await device.stop();
 }
});
