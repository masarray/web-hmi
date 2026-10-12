/** CP-15: typed historian contract, independent of browser/Node. */
import {VALID_TAG,type WireQuality} from './tag-protocol.ts';
export const MAX_TREND_TAGS=8;
export const DEFAULT_TREND_CONFIG:TrendConfig={tags:[],sampleMs:2000,retentionDays:3};
export interface TrendConfig {
 readonly tags:readonly string[];
 readonly sampleMs:number;
 readonly retentionDays:number;
}
export interface TrendRecord {
 readonly t:number;
 readonly tagId:string;
 readonly v:number|boolean|null;
 readonly q:WireQuality;
}
export interface TrendSeries {readonly tagId:string;readonly points:readonly TrendRecord[];}
export interface TrendResult {
 readonly from:number;readonly to:number;
 readonly series:readonly TrendSeries[];
 readonly scanned:number;
}
export interface TrendStatus {
 readonly revision:number;readonly config:TrendConfig;
 readonly recorded:number;readonly queued:number;readonly lastSavedAt:number|null;
 readonly storageError:string|null;
}
export interface TrendRequest {
 readonly tags:readonly string[];readonly from:number;readonly to:number;
 readonly maxPoints:number;
}
export function validateTrendConfig(value:unknown):TrendConfig {
 if(!value||typeof value!=='object'||Array.isArray(value)||
  Object.keys(value).some(k=>!['tags','sampleMs','retentionDays'].includes(k)))
  throw Error('Invalid trend settings');
 const x=value as Record<string,unknown>;
 if(!Array.isArray(x.tags)||x.tags.length>MAX_TREND_TAGS||
   !x.tags.every(v=>typeof v==='string'&&VALID_TAG.test(v))||
   new Set(x.tags).size!==x.tags.length)throw Error('Choose up to 8 unique tags');
 if(!Number.isSafeInteger(x.sampleMs)||(x.sampleMs as number)<1000||
   (x.sampleMs as number)>60000)throw Error('Sample interval must be 1–60 seconds');
 if(!Number.isSafeInteger(x.retentionDays)||(x.retentionDays as number)<1||
   (x.retentionDays as number)>7)throw Error('Retention must be 1–7 days');
 return {tags:[...x.tags],sampleMs:x.sampleMs as number,retentionDays:x.retentionDays as number};
}
export function validateTrendRequest(value:unknown,config:TrendConfig,now:number):TrendRequest{
 if(!value||typeof value!=='object'||Array.isArray(value)||
   Object.keys(value).some(k=>!['tags','from','to','maxPoints'].includes(k)))
   throw Error('Invalid trend request');
 const x=value as Record<string,unknown>;
 if(!Array.isArray(x.tags)||x.tags.length<1||x.tags.length>MAX_TREND_TAGS||
   !x.tags.every(t=>typeof t==='string'&&config.tags.includes(t))||
   new Set(x.tags).size!==x.tags.length)throw Error('Unknown historian tags');
 if(!Number.isSafeInteger(x.from)||!Number.isSafeInteger(x.to)||
   (x.from as number)<0||(x.to as number)<=(x.from as number)||
   (x.to as number)-(x.from as number)>86400000||
   (x.to as number)>now+30000)throw Error('Select a range up to 24 hours');
 if(!Number.isSafeInteger(x.maxPoints)||(x.maxPoints as number)<32||
   (x.maxPoints as number)>480)throw Error('Point budget must be 32–480');
 return {tags:[...x.tags],from:x.from as number,to:x.to as number,
  maxPoints:x.maxPoints as number};
}
/** Keep first/last and the extremes/quality gap per time bucket, bounded O(maxPoints). */
export function createTrendReducer(range:TrendRequest){

 const bags=new Map<string,Map<number,{min:TrendRecord|null;max:TrendRecord|null;
  bad:TrendRecord|null;first:TrendRecord|null;last:TrendRecord|null}>>();
 for(const tag of range.tags)bags.set(tag,new Map());
 const budget=Math.max(1,Math.floor(range.maxPoints/5));
 let scanned=0;
 const push=(p:TrendRecord):void=>{
  if(p.t<range.from||p.t>range.to)return;
  const bins=bags.get(p.tagId);if(!bins)return;
  scanned++;
  const ix=Math.min(budget-1,Math.floor((p.t-range.from)/
   (range.to-range.from)*budget));
  let bin=bins.get(ix);
  if(!bin){bin={min:null,max:null,bad:null,first:null,last:null};bins.set(ix,bin);}
  if(!bin.first)bin.first=p;
  bin.last=p;
  if(p.q!=='GOOD'||p.v===null)bin.bad=p;
  else{
   const value=Number(p.v);
   if(!bin.min||value<Number(bin.min.v))bin.min=p;
   if(!bin.max||value>Number(bin.max.v))bin.max=p;
  }
 };
 const result=():TrendResult=>({from:range.from,to:range.to,scanned,series:range.tags.map(tagId=>{
  const points:TrendRecord[]=[];
  for(const bin of [...(bags.get(tagId)?.entries()??[])].sort((a,b)=>a[0]-b[0])){
   const b=bin[1];
   // Do not collapse GOOD → STALE → GOOD transitions sharing one millisecond.
   // Deduplicate only references chosen by more than one summary slot.
   const unique=new Set<TrendRecord>();
   for(const p of [b.first,b.min,b.max,b.bad,b.last]){
    if(p)unique.add(p);
   }
   points.push(...[...unique].sort((a,b)=>a.t-b.t));
  }
  return {tagId,points};
 })});
 return {push,result};
}
export function downsampleTrend(records:readonly TrendRecord[],range:TrendRequest):TrendResult {
 const reducer=createTrendReducer(range);
 for(const record of records)reducer.push(record);
 return reducer.result();
}
