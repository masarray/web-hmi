import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Socket} from 'node:net';
import {ModbusTcpReadAdapter,type RegisterTag} from '../server/adapters/modbus-tcp.ts';
import {describeReadPlan,modbusFromEnvironment,readLabConfigFile}
 from '../server/adapter-config.ts';
import type {WireSample} from '../src/shared/tag-protocol.ts';

const mapping:readonly RegisterTag[]=[
 {tagId:'Plant/Run',functionCode:1,address:0,dataType:'bool'},
 {tagId:'Plant/Trip',functionCode:2,address:7,dataType:'bool'},
 {tagId:'Plant/Temperature',functionCode:3,address:0,dataType:'int16'},
 {tagId:'Plant/Energy',functionCode:3,address:1,dataType:'uint32'},
 {tagId:'Plant/Power',functionCode:4,address:0,dataType:'float32',wordOrder:'CDAB'}
];
async function eventually(check:()=>boolean,timeout=3500){
 const end=Date.now()+timeout;
 while(Date.now()<end){
  if(check())return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw Error('Missing expected protocol event before deadline');
}
test('JSON file preflight is safe, readable and has exact wire request plan',()=>{
 const cfg=readLabConfigFile('modbus-lab.example.json');
 assert.equal(cfg.tags.length,5);
 assert.equal(cfg.host,'127.0.0.1');
 assert.deepEqual(describeReadPlan(cfg).groups.map(x=>[x.functionCode,x.start,x.count]),[
  [1,0,1],[2,7,1],[3,20,3],[4,30,2]
 ]);
 const fromEnv=modbusFromEnvironment({
  HMI_SOURCE:'modbus-lab',HMI_MODBUS_CONFIG_FILE:'modbus-lab.example.json'
 });
 assert.deepEqual(fromEnv,cfg);
 assert.throws(()=>readLabConfigFile('../../package.json'));
 assert.throws(()=>readLabConfigFile('/etc/passwd'));
 assert.throws(()=>modbusFromEnvironment({
  HMI_SOURCE:'modbus-lab',HMI_MODBUS_CONFIG_FILE:'modbus-lab.example.json',
  HMI_MODBUS_TAGS:'[]'
 }));
});
test('TCP read-only FC01/02 bit packs and FC03/04 typed 32-bit values',async()=>{
 const requests:{fn:number;start:number;count:number}[]=[];
 let fault:'none'|'exception'|'nan'='none';
 const clients=new Set<Socket>();
 const server=createServer(socket=>{
  clients.add(socket);socket.on('close',()=>clients.delete(socket));
  let buffered=Buffer.alloc(0);
  socket.on('data',data=>{
   buffered=Buffer.concat([buffered,data]);
   while(buffered.length>=12){
    const req=buffered.subarray(0,12);
    buffered=buffered.subarray(12);
    const fn=req[7]!,start=req.readUInt16BE(8),count=req.readUInt16BE(10);
    requests.push({fn,start,count});
    let payload:Buffer;
    if(fault==='exception')payload=Buffer.from([fn|0x80,2]);
    else if(fn<=2){
     const bytes=Buffer.alloc(Math.ceil(count/8));
     for(let i=0;i<count;i++){
      const address=start+i;
      const on=fn===1?address===0:address===1;
      if(on)bytes[i>>3]=(bytes[i>>3]??0)|(1<<(i&7));
     }
     payload=Buffer.concat([Buffer.from([fn,bytes.length]),bytes]);
    }else{
     const bytes=Buffer.alloc(count*2);
     for(let i=0;i<count;i++){
      const address=start+i;
      let value=0;
      if(fn===3)value=address===0?0xfffe:address===1?1:address===2?1:0;
      if(fn===4)value=address===0?0:address===1?0x4148:0;
      bytes.writeUInt16BE(value,i*2);
     }
     if(fault==='nan'&&fn===4){
      bytes.writeUInt16BE(0,0);bytes.writeUInt16BE(0x7fc0,2);
     }
     payload=Buffer.concat([Buffer.from([fn,bytes.length]),bytes]);
    }
    const response=Buffer.alloc(7+payload.length);
    response.writeUInt16BE(req.readUInt16BE(0),0);
    response.writeUInt16BE(0,2);
    response.writeUInt16BE(payload.length+1,4);
    response[6]=req[6]!;payload.copy(response,7);
    // Split MBAP header to prove TCP fragmentation support.
    socket.write(response.subarray(0,3));
    setTimeout(()=>{if(!socket.destroyed)socket.write(response.subarray(3));},4);
   }
  });
 });
 await new Promise<void>(res=>server.listen(0,'127.0.0.1',res));
 const addr=server.address();
 if(!addr||typeof addr==='string')throw Error('No port');
 const samples:WireSample[]=[],statuses:string[]=[];
 const adapter=new ModbusTcpReadAdapter({
  host:'127.0.0.1',port:addr.port,unitId:1,tags:mapping,
  pollMs:60,requestTimeoutMs:120,reconnectMaxMs:140
 },s=>samples.push(s),s=>statuses.push(s));
 try{
  adapter.start();
  await eventually(()=>mapping.every(t=>samples.some(s=>s.tagId===t.tagId&&s.quality==='GOOD')));
  const latest=(id:string)=>samples.find(s=>s.tagId===id&&s.quality==='GOOD')!;
  assert.equal(latest('Plant/Run').value,true);
  assert.equal(latest('Plant/Trip').value,false);
  assert.equal(latest('Plant/Temperature').value,-2);
  assert.equal(latest('Plant/Energy').value,65537);
  assert.equal(latest('Plant/Power').value,12.5);
  assert.deepEqual(requests.slice(0,4),[
   {fn:1,start:0,count:1},{fn:2,start:7,count:1},
   {fn:3,start:0,count:3},{fn:4,start:0,count:2}
  ]);
  fault='nan';
  await eventually(()=>samples.some(s=>s.quality==='BAD'&&s.tagId==='Plant/Power'));
  assert.ok(statuses.includes('DEGRADED'));
  const failedIndex=samples.length;
  fault='none';
  await eventually(()=>samples.slice(failedIndex).some(s=>s.tagId==='Plant/Power'&&s.quality==='GOOD'));
  fault='exception';
  await eventually(()=>samples.slice(failedIndex).filter(s=>s.tagId==='Plant/Run'&&s.quality==='BAD').length>=1);
 }finally{
  await adapter.stop();
  for(const client of clients)client.destroy();
  await new Promise<void>(res=>server.close(()=>res()));
 }
 assert.equal(adapter.status(),'DISCONNECTED');
});
