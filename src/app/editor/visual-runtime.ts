/**
 * Deterministic, driver-neutral and fail-closed SVG state mapping.
 * No timers, DOM access, JS evaluation, network, or implicit polling.
 */
import type {Shape} from './document.ts';
import {TAG_STALE_AFTER_MS} from '../../shared/tag-protocol.ts';
import type {ProcessPart} from './process-graphics.ts';

export type TagQuality='GOOD'|'UNCERTAIN'|'BAD'|'STALE';
export type VisualRule='when-true'|'at-least';
export type PartEffect='fixed'|'state-color'|'hide-idle'|'spin-active';
export interface PartRule {readonly partIndex:number;readonly effect:PartEffect;}
export interface PartAppearance {readonly stroke:string;readonly visible:boolean;readonly spin:boolean;}
/** Per-source timeout, not a polling period. Shared across all symbols. */
export const STALE_AFTER_MS=TAG_STALE_AFTER_MS;
export interface TagSample {
  readonly tagId:string;
  readonly value:boolean|number|null;
  readonly quality:TagQuality;
  readonly sequence:number;
  /** Receive time from the consuming runtime, never an untrusted device clock. */
  readonly receivedAtMs?:number;
}
export type TagTable=ReadonlyMap<string,TagSample>;
export interface VisualState {
  readonly quality:TagQuality|'UNBOUND';
  readonly active:boolean;
  readonly warning:boolean;
  readonly animate:boolean;
  readonly stroke:string;
  readonly status:string;
}
const palette={
  active:'#67d9a8',
  inactive:'#91a8b6',
  uncertain:'#f2c16b',
  bad:'#fc7187',
  stale:'#9a98ae'
} as const;
export function updateTagSample(previous:TagTable, next:TagSample):TagTable {
  if(!next.tagId || next.tagId.length>160 || !/^[A-Za-z0-9_./:-]+$/.test(next.tagId))
    throw new Error('Invalid tag ID');
  if(!Number.isSafeInteger(next.sequence) || next.sequence<0 ||
    (next.value!==null && typeof next.value!=='boolean' &&
      (typeof next.value!=='number'||!Number.isFinite(next.value))))
    throw new Error('Invalid telemetry sample');
  if(next.receivedAtMs!==undefined &&
    (!Number.isSafeInteger(next.receivedAtMs)||next.receivedAtMs<0))
    throw new Error('Invalid receive timestamp');
  if(!(['GOOD','UNCERTAIN','BAD','STALE'] as string[]).includes(next.quality))
    throw new Error('Unknown quality');
  const current=previous.get(next.tagId);
  if(current && next.sequence<=current.sequence)return previous;
  const updated=new Map(previous);
  updated.set(next.tagId,{...next});
  return updated;
}
/** An absent source receive-time is stale when a freshness clock is supplied. */
export function effectiveQuality(sample:TagSample|undefined,nowMs?:number,
  timeoutMs=STALE_AFTER_MS):TagQuality {
  if(!sample)return 'STALE';
  if(nowMs===undefined)return sample.quality;
  if(!Number.isFinite(nowMs)||!Number.isFinite(timeoutMs)||timeoutMs<=0)
    throw new Error('Invalid freshness clock or timeout');
  if(sample.receivedAtMs===undefined || nowMs-sample.receivedAtMs>=timeoutMs)
    return 'STALE';
  return sample.quality;
}
/** Earliest future expiry; does not create per-tag timers or poll the page. */
export function nextFreshnessDeadline(samples:TagTable,nowMs:number,
  timeoutMs=STALE_AFTER_MS):number|null {
  let earliest=Infinity;
  for(const sample of samples.values()){
    const received=sample.receivedAtMs;
    if(received===undefined||sample.quality==='STALE')continue;
    const expires=received+timeoutMs;
    if(expires>nowMs&&expires<earliest)earliest=expires;
  }
  return Number.isFinite(earliest)?earliest:null;
}
export function evaluateVisual(shape:Pick<Shape,'tagId'|'animation'|'stroke'|'visualRule'|'threshold'>,
  sample:TagSample|undefined,preview:boolean,nowMs?:number,
  timeoutMs=STALE_AFTER_MS):VisualState {
  if(!preview || !shape.tagId){
    return {quality:'UNBOUND',active:false,warning:false,
      animate:preview && !shape.tagId && shape.animation!==undefined &&
        shape.animation!=='none',
      stroke:shape.stroke,status:shape.tagId?'DESIGN':'UNBOUND'};
  }
  const quality=effectiveQuality(sample,nowMs,timeoutMs);
  // GOOD is the only quality that can activate a visual.
  if(quality!=='GOOD'){
    return {quality,active:false,warning:true,animate:false,
      stroke:quality==='BAD'?palette.bad:quality==='UNCERTAIN'?palette.uncertain:palette.stale,
      status:quality};
  }
  const value=sample!.value;
  const threshold=shape.threshold??1;
  const active=shape.visualRule==='at-least'
    ?typeof value==='number' && Number.isFinite(value) && value>=threshold
    :value===true || (typeof value==='number' && value!==0);
  return {quality,active,warning:false,
    animate:active && shape.animation!==undefined && shape.animation!=='none',
    stroke:active?palette.active:palette.inactive,status:active?'ACTIVE':'IDLE'};
}
export function evaluatePartAppearance(shape:Shape,part:ProcessPart,index:number,
    visual:VisualState,preview:boolean):PartAppearance {
  const effect=shape.partRules?.find(rule=>rule.partIndex===index)?.effect;
  const statusColor=preview&&!!shape.tagId?visual.stroke:shape.stroke;
  const isWarning=preview&&!!shape.tagId&&visual.warning;
  const baseSpin=visual.animate&&shape.animation==='spin'&&part.rotor===true;
  if(effect==='fixed')return {stroke:shape.stroke,visible:true,spin:false};
  if(effect==='state-color')return {stroke:statusColor,visible:true,spin:baseSpin};
  if(effect==='hide-idle')return {
    stroke:statusColor,visible:!preview||!shape.tagId||
      (visual.quality==='GOOD'&&visual.active),
    spin:baseSpin&&!isWarning
  };
  if(effect==='spin-active')return {stroke:statusColor,visible:true,
    spin:visual.animate&&shape.animation==='spin'};
  return {stroke:part.rotor===true?statusColor:
    isWarning?visual.stroke:shape.stroke,visible:true,spin:baseSpin};
}
export function evaluatePage(shapes:readonly Shape[],samples:TagTable,preview:boolean,
  nowMs?:number,timeoutMs=STALE_AFTER_MS):
    ReadonlyMap<string,VisualState> {
  const result=new Map<string,VisualState>();
  for(const shape of shapes){
    if(shape.kind==='symbol')result.set(shape.id,
      evaluateVisual(shape,samples.get(shape.tagId),preview,nowMs,timeoutMs));
  }
  return result;
}
