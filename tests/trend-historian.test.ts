import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TrendHistorian,type TrendStore} from '../server/trend-historian.ts';
import {createTrendFileStore} from '../server/trend-storage.ts';
import {validateTrendConfig,validateTrendRequest,downsampleTrend,
 type TrendRecord,type TrendConfig} from '../src/shared/trend-contract.ts';
import {createTagHub} from '../server/tag-hub.ts';
import {DeviceRuntime} from '../server/device-runtime.ts';
import {createDeviceConfigHandler} from '../server/device-config-api.ts';
const tags=['PLC1/Pump/Pressure','PLC2/Pump/Pressure'];
const base=Date.now();
const config:TrendConfig={tags,sampleMs:1000,retentionDays:3};
const record=(t:number,tagId=tags[0]!,v:number|null=1,q:'GOOD'|'BAD'='GOOD'):TrendRecord=>({
 t,tagId,v,q});
function fakeStore(){
 const points:TrendRecord[]=[];let saved:TrendConfig|null=null,rev=0;
 const store:TrendStore={
  saveConfig:(cfg,r)=>{saved=cfg;rev=r;},
  append:rows=>{points.push(...rows);},
  async *read(from,to){for(const point of points)if(point.t>=from&&point.t<=to)yield point;}
 };
 return {store,points,get saved(){return saved;},get revision(){return rev}};
}
test('shared validation rejects invalid/duplicate tags and unbounded queries',()=>{
 assert.equal(validateTrendConfig(config).tags.length,2);
 for(const sample of [
  {...config,tags:[tags[0],tags[0]]},
  {...config,tags:['<script>']},
  {...config,tags:Array.from({length:9},(_,i)=>'Tag/'+i)},
  {...config,sampleMs:100},
  {...config,retentionDays:100}
 ])assert.throws(()=>validateTrendConfig(sample));
 const from=base-60000,to=base;
 assert.equal(validateTrendRequest({tags:[tags[0]],from,to,maxPoints:100},config,base).to,to);
 assert.throws(()=>validateTrendRequest({tags:['Unknown'],from,to,maxPoints:100},config,base));
 assert.throws(()=>validateTrendRequest({tags:[tags[0]],from:base-86400001,to,maxPoints:100},config,base));
 assert.throws(()=>validateTrendRequest({tags:[tags[0]],from,to,maxPoints:9999},config,base));
});
test('historian records configured tags on acquisition, rate limits and preserves quality gaps',async()=>{
 const f=fakeStore();let now=base;
 const h=new TrendHistorian(f.store,()=>now);
 try{
  h.configure(config,0);
  h.observe({tagId:tags[0]!,value:20,quality:'GOOD',sequence:1});
  now+=100;
  h.observe({tagId:tags[0]!,value:21,quality:'GOOD',sequence:2}); // rate gate
  h.observe({tagId:'Ignored/Tag',value:22,quality:'GOOD',sequence:3});
  now+=100;
  h.observe({tagId:tags[0]!,value:null,quality:'BAD',sequence:4}); // immediate gap
  now+=1000;
  h.observe({tagId:tags[0]!,value:23,quality:'GOOD',sequence:5});
  h.flush();
  assert.deepEqual(f.points.map(p=>[p.v,p.q]),[[20,'GOOD'],[null,'BAD'],[23,'GOOD']]);
  assert.equal(h.status().recorded,3);
  assert.equal(h.status().storageError,null);
  const result=await h.query({tags:[tags[0]],from:base-1000,to:now+1,maxPoints:200});
  assert.equal(result.scanned,3);
  assert.ok(result.series[0]!.points.some(p=>p.q==='BAD'));
  h.sourceReset();h.flush();
  assert.equal(f.points.at(-1)?.q,'STALE');
 }finally{h.close();}
});
test('historian bounded min/max preserves spikes and BAD gaps without replay arrays',()=>{
 const items:TrendRecord[]=[];
 for(let i=0;i<3000;i++)
  items.push(record(base-60000+i*20,tags[0]!,i===1700?999:i===1900?-500:10));
 items.push(record(base-20000,tags[0]!,null,'BAD'));
 const result=downsampleTrend(items,{
  tags:[tags[0]],from:base-60000,to:base,maxPoints:200
 });
 assert.ok(result.series[0]!.points.length<=200);
 assert.ok(result.series[0]!.points.some(p=>p.v===999));
 assert.ok(result.series[0]!.points.some(p=>p.v===-500));
 assert.ok(result.series[0]!.points.some(p=>p.q==='BAD'));
});
test('durable UTC daily store survives restart, bounded selected-tag history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'webhmi-history-'));
 try{
  const first=createTrendFileStore(dir);
  first.store.saveConfig(config,3);
  const points=[
   record(base-3600000,tags[0],44),
   record(base-3500000,tags[1],80),
   record(base-3400000,tags[0],null,'BAD')
  ];
  first.store.append(points,3);
  const restarted=createTrendFileStore(dir);
  assert.equal(restarted.restore()?.revision,3);
  assert.deepEqual(restarted.restore()?.config.tags,tags);
  const seen:TrendRecord[]=[];
  for await(const p of restarted.store.read(base-4000000,base))seen.push(p);
  assert.deepEqual(seen,points);
  assert.ok(readdirSync(join(dir,'historian')).some(s=>s.endsWith('.jsonl')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('configuration revision conflict and storage failure are fail-closed',()=>{
 const store=fakeStore();const h=new TrendHistorian(store.store,()=>base);
 try{
  h.configure(config,0);
  assert.throws(()=>h.configure({...config,tags:[]},0),/conflict/);
  assert.deepEqual(h.status().config.tags,tags);
 }finally{h.close();}
 const failing:TrendStore={
  saveConfig(){throw Error('Disk full');},
  append(){throw Error('Disk full');},
  async *read(){yield* [] as TrendRecord[];}
 };
 const bad=new TrendHistorian(failing,()=>base);
 try{
  assert.throws(()=>bad.configure(config,0),/Disk full/);
  assert.equal(bad.status().config.tags.length,0);
 }finally{bad.close();}
});
test('historian HTTP requires admin+allowed Origin, server broadcasts samples once',async()=>{
 const f=fakeStore();let now=base;
 const historian=new TrendHistorian(f.store,()=>now);
 const hub=createTagHub({demo:false,heartbeatMs:200});
 const runtime=new DeviceRuntime(hub);
 hub.setTrendObserver(s=>historian.observe(s),()=>historian.sourceReset());
 const TOKEN='cp15-ci-secret-token-32-characters-more';
 const ORIGIN='http://127.0.0.1:4200';
 hub.setControlHandler(createDeviceConfigHandler(runtime,{token:TOKEN,origins:[ORIGIN]},
   undefined,undefined,historian));
 await new Promise<void>(resolve=>hub.http.listen(0,'127.0.0.1',resolve));
 const address=hub.http.address();
 if(!address||typeof address==='string')throw Error('No bound port');
 const host='http://127.0.0.1:'+address.port;
 const call=(path:string,method='GET',body?:unknown,token=TOKEN,origin=ORIGIN)=>
  fetch(host+path,{method,headers:{Origin:origin,Authorization:'Bearer '+token,
   ...(body===undefined?{}:{'Content-Type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{
  assert.equal((await call('/api/trends','GET',undefined,'bad')).status,401);
  assert.equal((await call('/api/trends','GET',undefined,TOKEN,'https://evil.test')).status,403);
  const set=await call('/api/trends/config','POST',{revision:0,...config});
  assert.equal(set.status,200);
  hub.publish({tagId:tags[0]!,value:25,quality:'GOOD',sequence:1});
  assert.equal(hub.publish({tagId:tags[0]!,value:26,quality:'GOOD',sequence:1}),false);
  now+=1500;
  hub.publish({tagId:tags[0]!,value:28,quality:'GOOD',sequence:2});
  const data=await call('/api/trends/query','POST',{
   tags:[tags[0]],from:base-2000,to:now,maxPoints:200
  });
  assert.equal(data.status,200);
  const result=await data.json();
  assert.equal(result.scanned,2);
  assert.deepEqual(result.series[0].points.map((p:TrendRecord)=>p.v),[25,28]);
  assert.equal((await call('/api/trends/config','POST',{revision:0,...config})).status,409);
  assert.equal((await call('/api/trends/query','POST',{
   tags:['Unconfigured/Tag'],from:base-2000,to:now,maxPoints:200
  })).status,400);
 }finally{historian.close();await runtime.stop();await hub.close();}
});

test('sub-millisecond source loss remains a visible gap in downsampled history',()=>{
 const t=base-1000;
 const sameTime=[
  record(t,tags[0]!,32,'GOOD'),
  {t,tagId:tags[0]!,v:null,q:'STALE' as const},
  record(t,tags[0]!,33,'GOOD')
 ];
 const history=downsampleTrend(sameTime,{
  tags:[tags[0]!],from:t-100,to:t+100,maxPoints:40
 });
 assert.deepEqual(history.series[0]!.points.map(p=>p.q),
  ['GOOD','STALE','GOOD']);
 assert.deepEqual(history.series[0]!.points.map(p=>p.v),[32,null,33]);
});
