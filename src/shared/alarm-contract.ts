/** CP-14 alarm contracts shared by the Node engine and Angular operator view. */
import {VALID_TAG} from './tag-protocol.ts';
export type AlarmSeverity='warning'|'critical';
export type AlarmCondition='above'|'below'|'equals';
export interface AlarmRule {
 readonly id:string;
 readonly label:string;
 readonly tagId:string;
 readonly condition:AlarmCondition;
 readonly threshold:number;
 readonly hysteresis:number;
 readonly severity:AlarmSeverity;
}
export interface AlarmConfiguration {readonly rules:readonly AlarmRule[];}
export type AlarmPhase='NORMAL'|'ACTIVE'|'UNKNOWN';
export type AlarmEventType='ACTIVE'|'RETURN'|'ACK'|'QUALITY_LOST'|'QUALITY_RESTORED';
export interface AlarmState {
 readonly id:string;readonly label:string;readonly tagId:string;
 readonly severity:AlarmSeverity;readonly phase:AlarmPhase;
 readonly acknowledged:boolean;readonly since:number|null;
 readonly lastValue:number|boolean|null;
}
export interface AlarmEvent {
 readonly id:number;readonly time:number;
 readonly ruleId:string;readonly label:string;readonly tagId:string;
 readonly severity:AlarmSeverity;readonly type:AlarmEventType;
 readonly value:number|boolean|null;
}
export interface AlarmSnapshot {
 readonly revision:number;
 readonly rules:readonly AlarmRule[];
 readonly active:readonly AlarmState[];
 readonly recent:readonly AlarmEvent[];
 readonly unacknowledged:number;
 readonly storageError:string|null;
}
export function validateAlarmConfig(value:unknown):AlarmConfiguration {
 if(!value||typeof value!=='object'||Array.isArray(value)||
  Object.keys(value).some(key=>key!=='rules'))throw Error('Invalid alarm configuration');
 const raw=(value as Record<string,unknown>).rules;
 if(!Array.isArray(raw)||raw.length>64)throw Error('Maximum 64 alarms');
 const seen=new Set<string>();
 const rules:AlarmRule[]=[];
 for(const item of raw){
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('Invalid alarm rule');
  const x=item as Record<string,unknown>;
  if(Object.keys(x).some(k=>!['id','label','tagId','condition','threshold','hysteresis','severity'].includes(k))||
    typeof x.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(x.id)||seen.has(x.id)||
    typeof x.label!=='string'||x.label.trim()!==x.label||x.label.length<1||x.label.length>80||
    /[<>\r\n]/.test(x.label)||typeof x.tagId!=='string'||!VALID_TAG.test(x.tagId)||
    !['above','below','equals'].includes(String(x.condition))||
    typeof x.threshold!=='number'||!Number.isFinite(x.threshold)||
    typeof x.hysteresis!=='number'||!Number.isFinite(x.hysteresis)||
    x.hysteresis<0||x.hysteresis>1e9||
    !['warning','critical'].includes(String(x.severity)))
   throw Error('Invalid or duplicate alarm rule');
  if(x.condition==='equals'&&x.hysteresis!==0)throw Error('Equals alarm cannot have hysteresis');
  seen.add(x.id);rules.push(x as unknown as AlarmRule);
 }
 return {rules};
}
/** Pure hysteresis: enter at threshold, leave only outside deadband. */
export function isAlarmActive(rule:AlarmRule,value:number|boolean,previousActive:boolean):boolean {
 const n=typeof value==='boolean'?(value?1:0):value;
 switch(rule.condition){
  case 'above':return previousActive?n>rule.threshold-rule.hysteresis:n>rule.threshold;
  case 'below':return previousActive?n<rule.threshold+rule.hysteresis:n<rule.threshold;
  case 'equals':return n===rule.threshold;
 }
}
