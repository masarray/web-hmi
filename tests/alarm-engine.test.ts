import test from 'node:test';
import assert from 'node:assert/strict';
import {AlarmEngine,type AlarmStore} from '../server/alarm-engine.ts';
import {isAlarmActive,validateAlarmConfig,type AlarmConfiguration,
 type AlarmEvent,type AlarmRule} from '../src/shared/alarm-contract.ts';
import {createTagHub} from '../server/tag-hub.ts';
import {createDeviceConfigHandler} from '../server/device-config-api.ts';
import {DeviceRuntime} from '../server/device-runtime.ts';
import type {WireSample} from '../src/shared/tag-protocol.ts';

const warning:AlarmRule={id:'pressureHigh',label:'High pressure',
 tagId:'PLC1/Pump/Pressure',condition:'above',threshold:80,hysteresis:5,severity:'critical'};
const low:AlarmRule={id:'tempLow',label:'Low temperature',
 tagId:'PLC1/Pump/Temp',condition:'below',threshold:10,hysteresis:2,severity:'warning'};
function harness(rules:AlarmRule[]=[warning],saveFail=false){
 let now=1000;
 const saved:AlarmEvent[]=[];
 let configSaves=0,throwAppend=false;
 const store:AlarmStore={
  saveRules:()=>{if(saveFail)throw Error('Disk full');configSaves++;},
  append:event=>{if(throwAppend)throw Error('Disk unavailable');saved.push(event);}
 };
 const engine=new AlarmEngine(store,()=>now);
 engine.configure({rules},0);
 const sample=(tagId:string,value:number|null,quality:WireSample['quality']='GOOD')=>
  engine.observe({tagId,value,quality,sequence:1});
 return {engine,saved,sample,setTime:(time:number)=>{now=time;},
  get saves(){return configSaves;},setDiskFail:(enabled:boolean)=>{throwAppend=enabled;}};
}
test('alarm rule validation rejects duplicates, unsafe tags, NaN and inconsistent hysteresis',()=>{
 const config=validateAlarmConfig({rules:[warning,low]});
 assert.equal(config.rules.length,2);
 assert.throws(()=>validateAlarmConfig({rules:[warning,warning]}));
 assert.throws(()=>validateAlarmConfig({rules:[{...warning,tagId:'<script>'}]}));
 assert.throws(()=>validateAlarmConfig({rules:[{...warning,threshold:NaN}]}));
 assert.throws(()=>validateAlarmConfig({rules:[{...warning,hysteresis:-1}]}));
 assert.throws(()=>validateAlarmConfig({rules:[{...warning,condition:'equals',hysteresis:1}]}));
 assert.throws(()=>validateAlarmConfig({rules:Array.from({length:65},(_,i)=>({
  ...warning,id:'Rule'+i
 }))}));
 assert.equal(isAlarmActive(warning,81,false),true);
 assert.equal(isAlarmActive(warning,78,true),true);
 assert.equal(isAlarmActive(warning,75,true),false);
});
test('alarm trigger, hysteresis, ACK, return and new alarm sequence',()=>{
 const h=harness();
 h.sample(warning.tagId,70);
 assert.equal(h.engine.snapshot().unacknowledged,0);
 h.sample(warning.tagId,90);
 assert.equal(h.engine.snapshot().unacknowledged,1);
 assert.equal(h.engine.snapshot().active[0]?.phase,'ACTIVE');
 assert.equal(h.engine.snapshot().recent[0]?.type,'ACTIVE');
 h.setTime(2000);
 h.sample(warning.tagId,79); // holds due deadband
 assert.equal(h.saved.length,1);
 h.engine.acknowledge('pressureHigh');
 assert.equal(h.engine.snapshot().unacknowledged,0);
 assert.equal(h.engine.snapshot().recent[0]?.type,'ACK');
 h.sample(warning.tagId,74); // leave
 assert.equal(h.engine.snapshot().active.length,0);
 assert.equal(h.engine.snapshot().recent[0]?.type,'RETURN');
 h.sample(warning.tagId,90);
 assert.equal(h.engine.snapshot().unacknowledged,1);
 assert.equal(h.engine.snapshot().recent[0]?.type,'ACTIVE');
 assert.deepEqual(h.saved.map(e=>e.id),[1,2,3,4]);
});
test('BAD/STALE quality never returns active alarm to normal and resets remain unknown',()=>{
 const h=harness();
 h.sample(warning.tagId,95);
 h.sample(warning.tagId,null,'BAD');
 assert.equal(h.engine.snapshot().active[0]?.phase,'UNKNOWN');
 assert.equal(h.engine.snapshot().recent[0]?.type,'QUALITY_LOST');
 h.sample(warning.tagId,null,'STALE');
 assert.equal(h.saved.length,2);
 h.engine.sourceReset();
 assert.equal(h.engine.snapshot().active[0]?.phase,'UNKNOWN');
 h.sample(warning.tagId,100,'GOOD');
 assert.equal(h.engine.snapshot().active[0]?.phase,'ACTIVE');
 assert.equal(h.engine.snapshot().recent[0]?.type,'QUALITY_RESTORED');
 h.sample(warning.tagId,70,'GOOD');
 assert.equal(h.engine.snapshot().active.length,0);
});
test('alarm history restoration preserves unreturned ACK and event sequence',()=>{
 const h=harness();
 h.sample(warning.tagId,90);
 h.engine.acknowledge(warning.id);
 const restored=new AlarmEngine({saveRules:()=>{},append:event=>h.saved.push(event)},()=>5000,{
  config:{rules:[warning]},revision:1,history:h.saved
 });
 assert.equal(restored.snapshot().revision,1);
 assert.equal(restored.snapshot().active[0]?.phase,'UNKNOWN');
 assert.equal(restored.snapshot().active[0]?.acknowledged,true);
 restored.observe({tagId:warning.tagId,value:95,quality:'GOOD',sequence:10});
 assert.equal(restored.snapshot().unacknowledged,0);
 restored.observe({tagId:warning.tagId,value:60,quality:'GOOD',sequence:11});
 assert.equal(restored.snapshot().recent[0]?.id,3);
});
test('event storage failure does not fabricate ACK or clear a dangerous alarm',()=>{
 const h=harness();
 h.sample(warning.tagId,90);
 h.setDiskFail(true);
 assert.throws(()=>h.engine.acknowledge(warning.id),/persisted/);
 assert.equal(h.engine.snapshot().unacknowledged,1);
 assert.match(h.engine.snapshot().storageError??'',/Disk unavailable/);
 h.sample(warning.tagId,70); // cannot commit return event
 assert.equal(h.engine.snapshot().active[0]?.phase,'ACTIVE');
 h.setDiskFail(false);
 h.sample(warning.tagId,70);
 assert.equal(h.engine.snapshot().active.length,0);
 assert.equal(h.engine.snapshot().storageError,null);
});
test('config revision conflicts and disk failure leave prior rules untouched',()=>{
 const h=harness();
 assert.throws(()=>h.engine.configure({rules:[low]},0),/conflict/);
 assert.equal(h.engine.snapshot().rules[0]?.id,warning.id);
 assert.throws(()=>h.engine.configure({rules:[low]},2),/conflict/);
 assert.equal(h.engine.snapshot().rules.length,1);
 const failing=new AlarmEngine({saveRules:()=>{throw Error('Disk full');},append:()=>{}});
 assert.throws(()=>failing.configure({rules:[low]},0),/Disk full/);
 assert.equal(failing.snapshot().rules.length,0);
});
test('server hub observers process samples once, rejected duplicates do not trigger alarms',async()=>{
 const h=harness();
 const hub=createTagHub({demo:false,heartbeatMs:150});
 hub.setAlarmObserver(sample=>h.engine.observe(sample),()=>h.engine.sourceReset());
 try{
  await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
  hub.publish({tagId:warning.tagId,value:90,quality:'GOOD',sequence:1});
  assert.equal(h.saved.length,1);
  assert.equal(hub.publish({tagId:warning.tagId,value:90,quality:'GOOD',sequence:1}),false);
  assert.equal(h.saved.length,1);
  hub.resetSource('MODBUS_TCP');
  assert.equal(h.engine.snapshot().active[0]?.phase,'UNKNOWN');
 }finally{await hub.close();}
});
test('authenticated alarm API config/ACK, unauthorized attempts fail without changing alarm',async()=>{
 const h=new AlarmEngine();
 const hub=createTagHub({demo:false});
 hub.setAlarmObserver(s=>h.observe(s),()=>h.sourceReset());
 const runtime=new DeviceRuntime(hub);
 const key='cp14-alarm-admin-credential-for-ci-32-chars';
 const origin='http://127.0.0.1:4200';
 hub.setControlHandler(createDeviceConfigHandler(runtime,{token:key,origins:[origin]},undefined,h));
 await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
 const addr=hub.http.address();
 if(!addr||typeof addr==='string')throw Error('No port');
 const base='http://127.0.0.1:'+addr.port;
 const request=(path:string,method='GET',body?:unknown,token=key,headerOrigin=origin)=>
  fetch(base+path,{method,headers:{Origin:headerOrigin,Authorization:'Bearer '+token,
   ...(body===undefined?{}:{'Content-Type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  assert.equal((await request('/api/alarms','GET',undefined,'invalid')).status,401);
  assert.equal((await request('/api/alarms','GET',undefined,key,'https://evil.test')).status,403);
  const applied=await request('/api/alarms/config','POST',{revision:0,rules:[warning]});
  assert.equal(applied.status,200);
  hub.publish({tagId:warning.tagId,value:90,quality:'GOOD',sequence:1});
  const snapshot=await (await request('/api/alarms')).json() as {unacknowledged:number};
  assert.equal(snapshot.unacknowledged,1);
  assert.equal((await request('/api/alarms/ack','POST',{id:warning.id},'wrong')).status,401);
  const ack=await request('/api/alarms/ack','POST',{id:warning.id});
  assert.equal(ack.status,200);
  assert.equal(((await ack.json()) as {unacknowledged:number}).unacknowledged,0);
  assert.equal((await request('/api/alarms/config','POST',{
    revision:0,rules:[warning]
  })).status,409);
  assert.equal((await request('/api/alarms/ack','POST',{id:'no-such-alarm'})).status,400);
 }finally{await runtime.stop();await hub.close();}
});
