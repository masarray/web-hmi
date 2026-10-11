/** CP-14 industrial alarm evaluator: server-side, quality-aware and operator-acknowledged. */
import {isAlarmActive,validateAlarmConfig,
 type AlarmConfiguration,type AlarmRule,type AlarmState,type AlarmEvent,
 type AlarmSnapshot,type AlarmEventType} from '../src/shared/alarm-contract.ts';
import type {WireSample} from '../src/shared/tag-protocol.ts';
export interface AlarmStore {
 saveRules:(config:AlarmConfiguration,revision:number)=>void;
 append:(event:AlarmEvent)=>void;
}
interface Runtime {
 rule:AlarmRule;active:boolean;acknowledged:boolean;qualityOk:boolean;
 since:number|null;lastValue:number|boolean|null;
}
const HISTORY_LIMIT=200;
const emptyStore:AlarmStore={saveRules:()=>{},append:()=>{}};
export class AlarmEngine {
 private config:AlarmConfiguration={rules:[]};
 private revision=0;
 private readonly states=new Map<string,Runtime>();
 private readonly byTag=new Map<string,Runtime[]>();
 private history:AlarmEvent[]=[];
 private eventId=0;
 private storageError:string|null=null;
 private readonly store:AlarmStore;
 private readonly now:()=>number;
 constructor(store:AlarmStore=emptyStore,now:()=>number=Date.now,
  persisted?:{config:AlarmConfiguration;revision:number;history:readonly AlarmEvent[]}){
  this.store=store;
  this.now=now;
  if(persisted){
   this.load(persisted.config,persisted.revision,persisted.history);
  }
 }
 private reindex():void {
  this.byTag.clear();
  for(const state of this.states.values()){
   let list=this.byTag.get(state.rule.tagId);
   if(!list){list=[];this.byTag.set(state.rule.tagId,list);}
   list.push(state);
  }
 }
 private append(state:Runtime,type:AlarmEventType,value:number|boolean|null):boolean {
  const event:AlarmEvent={
   id:this.eventId+1,time:this.now(),ruleId:state.rule.id,label:state.rule.label,
   tagId:state.rule.tagId,severity:state.rule.severity,type,value
  };
  try{
   this.store.append(event);
   this.storageError=null;
  }catch(error){
   this.storageError=error instanceof Error?error.message:'Alarm event storage unavailable';
   return false;
  }
  this.eventId=event.id;
  this.history.push(event);
  if(this.history.length>HISTORY_LIMIT)this.history.shift();
  return true;
 }
 load(config:AlarmConfiguration,revision:number,history:readonly AlarmEvent[]=[]):void {
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid alarm revision');
  const safe=validateAlarmConfig(config);
  this.config=safe;this.revision=revision;this.states.clear();
  this.history=[...history].slice(-HISTORY_LIMIT);
  this.eventId=Math.max(0,...history.map(x=>x.id));
  for(const rule of safe.rules)this.states.set(rule.id,{
   rule,active:false,acknowledged:false,qualityOk:false,since:null,lastValue:null
  });
  // Restore unreturned alarms and ACK state after a server restart. Quality
  // remains unknown until a fresh GOOD sample arrives.
  for(const event of history){
   const state=this.states.get(event.ruleId);
   if(!state)continue;
   if(event.type==='ACTIVE'){state.active=true;state.acknowledged=false;state.since=event.time;}
   if(event.type==='ACK'&&state.active)state.acknowledged=true;
   if(event.type==='RETURN'){state.active=false;state.acknowledged=false;state.since=null;}
  }
  this.reindex();
 }
 configure(input:unknown,expectedRevision:number):AlarmSnapshot {
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==this.revision)
   throw Error('Alarm revision conflict');
  const next=validateAlarmConfig(input);
  this.store.saveRules(next,this.revision+1); // persist first, no partial rule replacement
  const previous=new Map(this.states);
  this.config=next;
  this.revision++;
  this.states.clear();
  for(const rule of next.rules){
   const old=previous.get(rule.id);
   const same=old&&JSON.stringify(old.rule)===JSON.stringify(rule);
   this.states.set(rule.id,same?old:{
    rule,active:false,acknowledged:false,qualityOk:false,since:null,lastValue:null
   });
  }
  this.reindex();
  return this.snapshot();
 }
 observe(sample:WireSample):void {
  const rules=this.byTag.get(sample.tagId);
  if(!rules?.length)return;
  for(const state of rules){
   if(sample.quality!=='GOOD'||sample.value===null){
    if(state.qualityOk){
     if(!this.append(state,'QUALITY_LOST',sample.value))continue;
     state.qualityOk=false;
    }
    continue;
   }
   if(!state.qualityOk && state.lastValue!==null){
    if(!this.append(state,'QUALITY_RESTORED',sample.value))continue;
   }
   const next=isAlarmActive(state.rule,sample.value,state.active);
   if(next!==state.active){
    if(!this.append(state,next?'ACTIVE':'RETURN',sample.value))continue;
    state.active=next;
    state.acknowledged=false;
    state.since=next?this.now():null;
   }
   state.qualityOk=true;
   state.lastValue=sample.value;
  }
 }
 /** Hub source reset never clears an alarm optimistically. */
 sourceReset():void {
  for(const state of this.states.values()) {
   if(!state.qualityOk)continue;
   if(this.append(state,'QUALITY_LOST',null))state.qualityOk=false;
  }
 }
 acknowledge(id:string):AlarmSnapshot {
  const state=this.states.get(id);
  if(!state)throw Error('Alarm not found');
  if(!state.active)throw Error('Alarm is not active');
  if(!state.acknowledged){
   if(!this.append(state,'ACK',state.lastValue))
    throw Error('Alarm event cannot be persisted');
   state.acknowledged=true;
  }
  return this.snapshot();
 }
 snapshot():AlarmSnapshot {
  const active:AlarmState[]=[...this.states.values()]
   .filter(s=>s.active||!s.qualityOk)
   .map(s=>({
    id:s.rule.id,label:s.rule.label,tagId:s.rule.tagId,
    severity:s.rule.severity,phase:!s.qualityOk?'UNKNOWN':s.active?'ACTIVE':'NORMAL',
    acknowledged:s.acknowledged,since:s.since,lastValue:s.lastValue
   }))
   .sort((a,b)=>Number(a.acknowledged)-Number(b.acknowledged)||
    (a.severity==='critical'?-1:1)-(b.severity==='critical'?-1:1)||
    a.label.localeCompare(b.label));
  return {revision:this.revision,rules:this.config.rules,active,
   recent:[...this.history].reverse(),
   unacknowledged:active.filter(s=>s.phase==='ACTIVE'&&!s.acknowledged).length,
   storageError:this.storageError};
 }
}
