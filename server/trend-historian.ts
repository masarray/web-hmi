/** CP-15 acquisition-driven historian: no per-browser PLC polling. */
import {createTrendReducer,validateTrendConfig,validateTrendRequest,
 DEFAULT_TREND_CONFIG,type TrendConfig,type TrendRecord,
 type TrendRequest,type TrendResult,type TrendStatus}
 from '../src/shared/trend-contract.ts';
import type {WireSample} from '../src/shared/tag-protocol.ts';
export interface TrendStore {
 saveConfig:(config:TrendConfig,revision:number)=>void;
 append:(points:readonly TrendRecord[],days:number)=>void;
 read:(from:number,to:number)=>AsyncIterable<TrendRecord>;
}
export class TrendHistorian {
 private config:TrendConfig=DEFAULT_TREND_CONFIG;
 private revision=0;
 private queue:TrendRecord[]=[];
 private readonly last=new Map<string,{t:number;q:string;v:number|boolean|null}>();
 private recorded=0;
 private savedAt:number|null=null;
 private storageError:string|null=null;
 private timer:ReturnType<typeof setInterval>|null=null;
 private reading=false;
 private readonly store:TrendStore;
 private readonly now:()=>number;
 constructor(store:TrendStore,now:()=>number=Date.now,
  restored?:{config:TrendConfig;revision:number}){
  this.store=store;this.now=now;
  if(restored){
   this.config=validateTrendConfig(restored.config);
   if(!Number.isSafeInteger(restored.revision)||restored.revision<0)
    throw Error('Invalid historian revision');
   this.revision=restored.revision;
  }
  this.timer=setInterval(()=>{try{this.flush();}catch{/* reported in status */}},1000);
  this.timer.unref();
 }
 status():TrendStatus {
  return {revision:this.revision,config:this.config,recorded:this.recorded,
   queued:this.queue.length,lastSavedAt:this.savedAt,storageError:this.storageError};
 }
 configure(value:unknown,expectedRevision:number):TrendStatus {
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==this.revision)
   throw Error('Historian revision conflict');
  const next=validateTrendConfig(value);
  this.flush();
  this.store.saveConfig(next,this.revision+1);
  this.config=next;this.revision++;
  this.last.clear();
  return this.status();
 }
 observe(sample:WireSample):void {
  if(!this.config.tags.includes(sample.tagId))return;
  const now=this.now();
  const prev=this.last.get(sample.tagId);
  const qualityChanged=prev?.q!==sample.quality;
  if(prev&&!qualityChanged&&now-prev.t<this.config.sampleMs)return;
  const point:TrendRecord={t:now,tagId:sample.tagId,
   v:sample.quality==='GOOD'?sample.value:null,q:sample.quality};
  this.last.set(sample.tagId,{t:now,q:sample.quality,v:point.v});
  this.queue.push(point);
  if(this.queue.length>=256){try{this.flush();}catch{/* Storage alert is exposed in status; keep PLC polling. */}}
 }
 sourceReset():void{
  const now=this.now();
  for(const tagId of this.config.tags){
   const prev=this.last.get(tagId);
   if(!prev||prev.q==='STALE')continue;
   this.queue.push({t:now,tagId,v:null,q:'STALE'});
   this.last.set(tagId,{t:now,q:'STALE',v:null});
  }
  if(this.queue.length>=256){try{this.flush();}catch{/* Storage alert is exposed in status; keep PLC polling. */}}
 }
 flush():void {
  if(!this.queue.length)return;
  try{
   this.store.append(this.queue,this.config.retentionDays);
   this.recorded+=this.queue.length;
   this.queue=[];
   this.savedAt=this.now();
   this.storageError=null;
  }catch(error){
   this.storageError=error instanceof Error?error.message:'Historian storage unavailable';
   // Never silently claim data is persisted; bound memory when disk fails.
   if(this.queue.length>2048)this.queue=this.queue.slice(-2048);
   throw error;
  }
 }
 async query(input:unknown):Promise<TrendResult>{
  if(this.reading)throw Error('Historian query already running');
  const request=validateTrendRequest(input,this.config,this.now());
  this.flush();
  this.reading=true;
  try{
   const reducer=createTrendReducer(request);
   for await(const point of this.store.read(request.from,request.to))reducer.push(point);
   return reducer.result();
  }finally{this.reading=false;}
 }
 close():void{
  if(this.timer!==null){clearInterval(this.timer);this.timer=null;}
  this.flush();
 }
}
