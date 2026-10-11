/** Durable rule config + append-only event chronicle, with bounded journal rotation. */
import {existsSync,readFileSync,statSync,writeFileSync,appendFileSync,
 renameSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {validateAlarmConfig,type AlarmConfiguration,type AlarmEvent}
 from '../src/shared/alarm-contract.ts';
import type {AlarmStore} from './alarm-engine.ts';
const DIR=resolve(process.cwd(),'config');
const RULES=resolve(DIR,'alarm-rules.json');
const JOURNAL=resolve(DIR,'alarm-events.jsonl');
const PREVIOUS=resolve(DIR,'alarm-events.previous.jsonl');
const MAX_RULES_BYTES=32*1024;
const MAX_EVENT_BYTES=4*1024*1024;
function writeAtomic(path:string,value:string):void {
 const temp=path+'.tmp-'+randomBytes(8).toString('hex');
 try{
  writeFileSync(temp,value,{flag:'wx',mode:0o600});
  renameSync(temp,path);
 }catch(error){try{unlinkSync(temp);}catch{}throw error;}
}
function readEvents(path:string):AlarmEvent[]{
 if(!existsSync(path))return [];
 if(statSync(path).size>MAX_EVENT_BYTES+8192)throw Error('Alarm journal exceeds safe size');
 const raw=readFileSync(path,'utf8');
 const events:AlarmEvent[]=[];
 for(const line of raw.split('\n')){
  if(!line.trim())continue;
  const event=JSON.parse(line) as AlarmEvent;
  if(!event||!Number.isSafeInteger(event.id)||event.id<1||
   !Number.isSafeInteger(event.time)||event.time<0||
   typeof event.ruleId!=='string'||typeof event.type!=='string')
   throw Error('Corrupt persisted alarm event');
  events.push(event);
 }
 return events;
}
export function loadAlarmFiles():{
 config:AlarmConfiguration;revision:number;history:readonly AlarmEvent[]
}{
 let config:AlarmConfiguration={rules:[]},revision=0;
 if(existsSync(RULES)){
  const raw=readFileSync(RULES,'utf8');
  if(raw.length>MAX_RULES_BYTES)throw Error('Alarm configuration too large');
  const data=JSON.parse(raw) as Record<string,unknown>;
  if(!data||!Number.isSafeInteger(data['revision'])||
   (data['revision'] as number)<0||
   Object.keys(data).some(k=>!['revision','rules'].includes(k)))
   throw Error('Invalid stored alarm configuration');
  config=validateAlarmConfig({rules:data['rules']});
  revision=data['revision'] as number;
 }
 const all=[...readEvents(PREVIOUS),...readEvents(JOURNAL)];
 return {config,revision,history:all.slice(-200)};
}
export function makeAlarmFileStore():AlarmStore {
 return {
  saveRules(config,revision){
   const safe=validateAlarmConfig(config);
   const text=JSON.stringify({revision,rules:safe.rules},null,2)+'\n';
   if(text.length>MAX_RULES_BYTES)throw Error('Alarm configuration exceeds storage limit');
   writeAtomic(RULES,text);
  },
  append(event){
   const line=JSON.stringify(event)+'\n';
   if(line.length>8192)throw Error('Alarm event too large');
   if(existsSync(JOURNAL)&&statSync(JOURNAL).size+line.length>MAX_EVENT_BYTES){
    if(existsSync(PREVIOUS))unlinkSync(PREVIOUS);
    renameSync(JOURNAL,PREVIOUS);
   }
   appendFileSync(JOURNAL,line,{encoding:'utf8',mode:0o600});
  }
 };
}
