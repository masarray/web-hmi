/**
 * Deterministic, driver-neutral and fail-closed SVG state mapping.
 * No timers, DOM access, JS evaluation, network, or implicit polling.
 */
import type {Shape} from './document.ts';

export type TagQuality='GOOD'|'UNCERTAIN'|'BAD'|'STALE';
export type VisualRule='when-true'|'at-least';
export interface TagSample {
  readonly tagId:string;
  readonly value:boolean|number|null;
  readonly quality:TagQuality;
  readonly sequence:number;
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
  if(!(['GOOD','UNCERTAIN','BAD','STALE'] as string[]).includes(next.quality))
    throw new Error('Unknown quality');
  const current=previous.get(next.tagId);
  if(current && next.sequence<=current.sequence)return previous;
  const updated=new Map(previous);
  updated.set(next.tagId,{...next});
  return updated;
}
export function evaluateVisual(shape:Pick<Shape,'tagId'|'animation'|'stroke'|'visualRule'|'threshold'>,
  sample:TagSample|undefined,preview:boolean):VisualState {
  if(!preview || !shape.tagId){
    return {quality:'UNBOUND',active:false,warning:false,
      animate:preview && !shape.tagId && shape.animation!==undefined &&
        shape.animation!=='none',
      stroke:shape.stroke,status:shape.tagId?'DESIGN':'UNBOUND'};
  }
  const quality=sample?.quality??'STALE';
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
export function evaluatePage(shapes:readonly Shape[],samples:TagTable,preview:boolean):
    ReadonlyMap<string,VisualState> {
  const result=new Map<string,VisualState>();
  for(const shape of shapes){
    if(shape.kind==='symbol')result.set(shape.id,
      evaluateVisual(shape,samples.get(shape.tagId),preview));
  }
  return result;
}
