import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createTagHub} from '../server/tag-hub.ts';
import {parseSubscription} from '../src/shared/tag-protocol.ts';
const origin='http://127.0.0.1:4200';
async function create(){
 const hub=createTagHub({demo:false,heartbeatMs:200});
 await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
 const address=hub.http.address();
 if(!address||typeof address==='string')throw Error('Missing port');
 return {hub,url:'ws://127.0.0.1:'+address.port+'/ws/tags',
  health:'http://127.0.0.1:'+address.port+'/health'};
}
async function connect(url:string,at=origin){
 const ws=new WebSocket(url,{origin:at});
 const events:any[]=[];
 ws.on('message',(raw)=>{try{events.push(JSON.parse(raw.toString()));}catch{}});
 await once(ws,'open');
 return {ws,events};
}
async function waitFor(events:any[],predicate:(v:any)=>boolean){
 for(let n=0;n<200;n++){
  const found=events.find(predicate);
  if(found)return found;
  await new Promise(r=>setTimeout(r,10));
 }
 throw Error('Timed out waiting for wire event: '+JSON.stringify(events.slice(-3)));
}
async function stop(ws:WebSocket){ws.terminate();await once(ws,'close');}

test('read-only health and strict protocol validation',async()=>{
 const {hub,health}=await create();
 try{
  const r=await fetch(health);assert.equal(r.status,200);
  assert.deepEqual((await r.json()).readOnly,true);
  assert.throws(()=>parseSubscription({type:'write',version:1,tags:[]}));
  assert.throws(()=>parseSubscription({type:'subscribe',version:1,tags:['foo','foo']}));
  assert.throws(()=>parseSubscription({type:'subscribe',version:1,tags:['../../<script>']}));
  assert.throws(()=>parseSubscription({type:'subscribe',version:1,tags:Array(129).fill('Tag')}));
 }finally{await hub.close();}
});
test('one source feeds two browsers, exact subscriptions, late snapshot and monotonic samples',async()=>{
 const {hub,url}=await create();
 const clients:WebSocket[]=[];
 try{
  const a=await connect(url),b=await connect(url);
  clients.push(a.ws,b.ws);
  await waitFor(a.events,e=>e.type==='hello');
  for(const ws of clients)ws.send(JSON.stringify({
   type:'subscribe',version:1,tags:['Plant/Motor']
  }));
  await Promise.all([a,b].map(x=>waitFor(x.events,e=>e.type==='subscribed')));
  assert.equal(hub.metrics().clients,2);
  assert.equal(hub.metrics().subscriptions,2);
  assert.equal(hub.publish({tagId:'Plant/Motor',value:1,quality:'GOOD',sequence:1}),true);
  await Promise.all([a,b].map(x=>waitFor(x.events,e=>
   e.type==='sample'&&e.sample?.tagId==='Plant/Motor'&&e.sample?.value===1)));
  assert.equal(hub.publish({tagId:'Plant/Motor',value:0,quality:'BAD',sequence:1}),false);
  const c=await connect(url);clients.push(c.ws);
  c.ws.send(JSON.stringify({type:'subscribe',version:1,tags:['Plant/Motor']}));
  const snapshot=await waitFor(c.events,e=>e.type==='sample'&&e.sample?.sequence===1);
  assert.equal(snapshot.sample.value,1);
  a.ws.send(JSON.stringify({type:'subscribe',version:1,tags:['Pump/Pressure']}));
  await waitFor(a.events,e=>e.type==='subscribed'&&e.tags[0]==='Pump/Pressure');
  assert.equal(hub.metrics().subscriptions,3);
  hub.publish({tagId:'Plant/Motor',value:0,quality:'GOOD',sequence:2});
  await waitFor(b.events,e=>e.type==='sample'&&e.sample?.sequence===2);
  await waitFor(c.events,e=>e.type==='sample'&&e.sample?.sequence===2);
  assert.equal(a.events.filter(e=>e.type==='sample'&&e.sample?.sequence===2).length,0);
  hub.publish({tagId:'Pump/Pressure',value:55,quality:'GOOD',sequence:1});
  await waitFor(a.events,e=>e.type==='sample'&&e.sample?.tagId==='Pump/Pressure'&&e.sample?.value===55);
 }finally{for(const ws of clients)ws.terminate();await hub.close();}
});
test('unknown tag is STALE; unauthorized origin and writes are rejected',async()=>{
 const {hub,url}=await create();
 try{
  const {ws,events}=await connect(url);
  ws.send(JSON.stringify({type:'subscribe',version:1,tags:['Unknown/Tag']}));
  const status=await waitFor(events,e=>e.type==='sample'&&e.sample?.tagId==='Unknown/Tag');
  assert.equal(status.sample.quality,'STALE');
  ws.send(JSON.stringify({type:'write',tagId:'Unknown/Tag',value:1}));
  await once(ws,'close');
  for(let retry=0;retry<50&&hub.metrics().clients!==0;retry++)
    await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(hub.metrics().clients,0);
  const denied=new WebSocket(url,{origin:'https://malicious.example'});
  const [error]=await once(denied,'error');
  assert.match(String(error),/403/);
  assert.equal(hub.metrics().clients,0);
 }finally{await hub.close();}
});
test('acquisition ticks once regardless of browser subscriber count',async()=>{
 const hub=createTagHub({sourceIntervalMs:60,heartbeatMs:200});
 await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
 const address=hub.http.address();
 if(!address||typeof address==='string')throw Error('No address');
 const url='ws://127.0.0.1:'+address.port+'/ws/tags';
 const clients:WebSocket[]=[];
 try{
  for(let i=0;i<6;i++){
   const {ws}=await connect(url);clients.push(ws);
   ws.send(JSON.stringify({type:'subscribe',version:1,tags:['Plant/Motor']}));
  }
  await new Promise(r=>setTimeout(r,200));
  assert.equal(hub.metrics().clients,6);
  assert.equal(hub.metrics().subscriptions,6);
  assert.ok(hub.metrics().sourceTicks>=2);
  assert.ok(hub.metrics().sourceTicks<15);
 }finally{for(const ws of clients)ws.terminate();await hub.close();}
});

test('late subscriber sees expired cached GOOD as STALE, then fresh GOOD after update',async()=>{
 const hub=createTagHub({demo:false,heartbeatMs:200,staleMs:80});
 await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
 const address=hub.http.address();
 if(!address||typeof address==='string')throw Error('No test address');
 const url='ws://127.0.0.1:'+address.port+'/ws/tags';
 const sockets:WebSocket[]=[];
 try{
  hub.publish({tagId:'Plant/Motor',value:1,quality:'GOOD',sequence:1});
  await new Promise(resolve=>setTimeout(resolve,110));
  const {ws,events}=await connect(url);sockets.push(ws);
  ws.send(JSON.stringify({type:'subscribe',version:1,tags:['Plant/Motor']}));
  const stale=await waitFor(events,e=>e.type==='sample'&&e.sample?.sequence===1);
  assert.equal(stale.sample.quality,'STALE');
  assert.equal(stale.sample.value,null);
  hub.publish({tagId:'Plant/Motor',value:1,quality:'GOOD',sequence:2});
  const live=await waitFor(events,e=>e.type==='sample'&&e.sample?.sequence===2);
  assert.equal(live.sample.quality,'GOOD');
  assert.equal(live.sample.value,1);
 }finally{for(const ws of sockets)ws.terminate();await hub.close();}
});

test('server quality expires once without viewers; fresh updates rearm and reset isolates sources',async()=>{
 const hub=createTagHub({demo:false,heartbeatMs:100,staleMs:45});
 const alarms:{tagId:string;quality:string}[]=[];
 const trends:{tagId:string;quality:string}[]=[];
 let resets=0;
 hub.setAlarmObserver(s=>alarms.push(s),()=>{resets++;});
 hub.setTrendObserver(s=>trends.push(s),()=>{resets++;});
 try{
  hub.publish({tagId:'PLC1/Motor',value:1,quality:'GOOD',sequence:1});
  for(let i=0;i<35&&!alarms.some(s=>s.quality==='STALE');i++)
   await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(alarms.map(s=>s.quality),['GOOD','STALE']);
  assert.deepEqual(trends.map(s=>s.quality),['GOOD','STALE']);
  // Don't flood events every heartbeat while the acquisition is absent.
  await new Promise(resolve=>setTimeout(resolve,220));
  assert.equal(alarms.filter(s=>s.quality==='STALE').length,1);
  assert.equal(trends.filter(s=>s.quality==='STALE').length,1);
  assert.equal(hub.publish({tagId:'PLC1/Motor',value:2,quality:'GOOD',sequence:1}),false);
  assert.equal(alarms.length,2);
  hub.publish({tagId:'PLC1/Motor',value:2,quality:'GOOD',sequence:2});
  for(let i=0;i<35&&alarms.filter(s=>s.quality==='STALE').length<2;i++)
   await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(alarms.map(s=>s.quality),['GOOD','STALE','GOOD','STALE']);
  hub.resetSource('MODBUS_TCP');
  assert.equal(resets,2);
  await new Promise(resolve=>setTimeout(resolve,130));
  assert.equal(alarms.length,4); // old source cannot expire again after reset
 }finally{await hub.close();}
});
