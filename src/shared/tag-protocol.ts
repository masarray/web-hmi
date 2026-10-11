/** CP-07 read-only protocol. No commands, dynamic code or arbitrary tag names. */
export const WIRE_VERSION=1;
export const MAX_TAGS=128;
/** Shared end-to-end freshness contract, independent of transport heartbeat. */
export const TAG_STALE_AFTER_MS=3000;
export const VALID_TAG=/^[A-Za-z0-9_./:-]{1,160}$/;
export type WireQuality='GOOD'|'UNCERTAIN'|'BAD'|'STALE';
export interface WireSample{tagId:string;value:boolean|number|null;quality:WireQuality;sequence:number}
export type ClientMessage={type:'subscribe';version:1;tags:string[]};
export type ServerMessage=
 |{type:'hello';version:1;source:'DEMO'|'MODBUS_LAB'|'MODBUS_TCP';heartbeatMs:number}
 |{type:'subscribed';tags:string[]}
 |{type:'sample';sample:WireSample}
 |{type:'heartbeat';serverTime:number};
export function parseSubscription(value:unknown):ClientMessage {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Bad subscription');
 const m=value as Record<string,unknown>;
 if(m.type!=='subscribe'||m.version!==1||!Array.isArray(m.tags)||m.tags.length>MAX_TAGS)
  throw Error('Unsupported message');
 if(!m.tags.every(t=>typeof t==='string'&&VALID_TAG.test(t))||
  new Set(m.tags).size!==m.tags.length)throw Error('Invalid or duplicate tags');
 return {type:'subscribe',version:1,tags:m.tags as string[]};
}
export function validSample(value:unknown):value is WireSample{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const s=value as Record<string,unknown>;
 return typeof s.tagId==='string'&&VALID_TAG.test(s.tagId)&&
  (s.value===null||typeof s.value==='boolean'||
   (typeof s.value==='number'&&Number.isFinite(s.value)))&&
  ['GOOD','UNCERTAIN','BAD','STALE'].includes(String(s.quality))&&
  typeof s.sequence==='number'&&Number.isSafeInteger(s.sequence)&&s.sequence>=0;
}
