/** Versioned, executable-code-free project model. */
import {findSymbol} from './symbols.ts';
import type {VisualRule,PartRule} from './visual-runtime.ts';
import {findProcessGraphic} from './process-graphics.ts';
import {parseDynamicSymbol,findDynamicSymbol,type DynamicSymbol,type PointMode} from './dynamic-symbol.ts';
export type AnimationMode='none'|'spin'|'pulse';
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'text' | 'breaker' | 'symbol';
export interface Shape {
  id:string; kind:ShapeKind; name:string; x:number; y:number;
  width:number; height:number; fill:string; stroke:string;
  text:string; tagId:string;
  /** Optional additions keep existing v1 projects backward compatible. */
  symbolId?:string;
  animation?:AnimationMode;
  visualRule?:VisualRule;
  threshold?:number;
  /** Optional behavior overrides for indexed parts of an allowlisted inline SVG. */
  partRules?:PartRule[];
  pointMode?:PointMode;
}
export interface Page { id:string; name:string; shapes:Shape[] }
export interface Project {
  schemaVersion:1; id:string; name:string; activePageId:string; pages:Page[];
  /** Optional for v1 compatibility; imported symbol geometry travels with project. */
  customSymbols?:DynamicSymbol[];
}
const kinds:ReadonlySet<string> = new Set(['rect','ellipse','line','text','breaker','symbol']);
const idPattern=/^[A-Za-z0-9_-]{1,80}$/;
const hex=/^#[0-9a-fA-F]{6}$/;
const customSymbolId=/^user-[A-Za-z0-9_-]{1,64}$/;
const finite=(v:unknown,min:number,max:number):v is number=>
  typeof v==='number' && Number.isFinite(v) && v>=min && v<=max;
const named=(v:unknown,max:number):v is string=>
  typeof v==='string' && v.length>0 && v.length<=max;
const obj=(v:unknown):v is Record<string,unknown> =>
  v!==null && typeof v==='object' && !Array.isArray(v);
export function validPartRules(value:unknown,symbolId:unknown):value is PartRule[] {
  if(!Array.isArray(value)||value.length>16||
    typeof symbolId!=='string')return false;
  const graphic=findProcessGraphic(symbolId);
  if(!graphic)return false;
  const seen=new Set<number>();
  for(const entry of value){
    if(!obj(entry))return false;
    const index=entry.partIndex;
    if(typeof index!=='number'||!Number.isInteger(index)||
       index<0||index>=graphic.parts.length||seen.has(index)||
       !(['fixed','state-color','hide-idle','spin-active'] as unknown[]).includes(entry.effect))
      return false;
    seen.add(index);
  }
  return true;
}
export function isShape(v:unknown):v is Shape {
  return obj(v) && typeof v.id==='string' && idPattern.test(v.id) &&
    typeof v.kind==='string' && kinds.has(v.kind) &&
    named(v.name,100) && finite(v.x,-10000,10000) &&
    finite(v.y,-10000,10000) && finite(v.width,1,10000) &&
    finite(v.height,1,10000) &&
    typeof v.fill==='string' && hex.test(v.fill) &&
    typeof v.stroke==='string' && hex.test(v.stroke) &&
    typeof v.text==='string' && v.text.length<=160 &&
    typeof v.tagId==='string' && v.tagId.length<=160 &&
    (v.symbolId===undefined ||
      (typeof v.symbolId==='string' && (!!findSymbol(v.symbolId)||customSymbolId.test(v.symbolId)))) &&
    (v.kind!=='symbol'||(typeof v.symbolId==='string'&&
      (!!findSymbol(v.symbolId)||customSymbolId.test(v.symbolId)))) &&
    (v.animation===undefined||
      v.animation==='none'||v.animation==='spin'||v.animation==='pulse') &&
    (v.visualRule===undefined||v.visualRule==='when-true'||v.visualRule==='at-least') &&
    (v.threshold===undefined||finite(v.threshold,-1000000,1000000)) &&
    (v.partRules===undefined||validPartRules(v.partRules,v.symbolId)) &&
    (v.pointMode===undefined||v.pointMode==='single-point'||v.pointMode==='double-point');
}
function valueSymbols(value:unknown):DynamicSymbol[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>128)throw Error('Invalid custom symbol catalog');
  const seen=new Set<string>();
  return value.map(raw=>{
    const def=parseDynamicSymbol(raw);
    if(!customSymbolId.test(def.id)||seen.has(def.id)||!!findSymbol(def.id))
      throw Error('Duplicate or reserved custom symbol identifier');
    seen.add(def.id);
    return def;
  });
}
export function parseProject(v:unknown):Project {
  if (!obj(v) || v.schemaVersion!==1 || !named(v.id,80) ||
      !idPattern.test(v.id) || !named(v.name,120) ||
      !Array.isArray(v.pages) || v.pages.length<1 || v.pages.length>64 ||
      typeof v.activePageId!=='string')
    throw new Error('Invalid or unsupported HMI project format');
  const customSymbols:DynamicSymbol[]=valueSymbols(v.customSymbols);
  const customIds=new Set(customSymbols.map(s=>s.id));
  const pageIds=new Set<string>();
  const pages:Page[]=v.pages.map((raw:unknown)=>{
    if (!obj(raw) || typeof raw.id!=='string' ||
        !idPattern.test(raw.id) || pageIds.has(raw.id) ||
        !named(raw.name,120) || !Array.isArray(raw.shapes) ||
        raw.shapes.length>2000) throw new Error('Invalid HMI page');
    pageIds.add(raw.id);
    const shapeIds=new Set<string>();
    const shapes:Shape[]=raw.shapes.map((s:unknown)=>{
      if (!isShape(s) || shapeIds.has(s.id)||
        (s.kind==='symbol'&&typeof s.symbolId==='string'&&
          customSymbolId.test(s.symbolId)&&!customIds.has(s.symbolId)))
        throw new Error('Invalid or duplicate HMI shape');
      shapeIds.add(s.id);
      return {id:s.id,kind:s.kind,name:s.name,x:s.x,y:s.y,
        width:s.width,height:s.height,fill:s.fill,stroke:s.stroke,
        text:s.text,tagId:s.tagId,
        ...(s.symbolId!==undefined?{symbolId:s.symbolId}:{}),
        ...(s.animation!==undefined?{animation:s.animation}:{}),
        ...(s.visualRule!==undefined?{visualRule:s.visualRule}:{}),
        ...(s.threshold!==undefined?{threshold:s.threshold}:{}),
        ...(s.pointMode!==undefined?{pointMode:s.pointMode}:{}),
        ...(s.partRules!==undefined?{
          partRules:s.partRules.map(rule=>({partIndex:rule.partIndex,effect:rule.effect}))
        }:{})};
    });
    return {id:raw.id,name:raw.name,shapes};
  });
  if (!pageIds.has(v.activePageId)) throw new Error('Active page not found');
  return {schemaVersion:1,id:v.id,name:v.name,activePageId:v.activePageId,pages,
    ...(v.customSymbols!==undefined?{customSymbols}:{})};
}
export function initialProject():Project {
  const shape=(id:string,kind:ShapeKind,name:string,x:number,y:number,
    width:number,height:number,fill='#29465c',stroke='#80bcd6',
    text='',tagId=''):Shape=>
    ({id,kind,name,x,y,width,height,fill,stroke,text,tagId});
  return {schemaVersion:1,id:'sample-project',name:'Substation Demo',
    activePageId:'overview',pages:[{id:'overview',name:'Overview',shapes:[
      shape('heading','text','Title',75,55,280,32,'#ecf3f8','#ecf3f8','132 kV SWITCHYARD'),
      shape('bus','line','Busbar A',95,155,990,1,'#69c4d8','#69c4d8'),
      shape('feeder-a','line','Bay A feeder',270,155,1,300),
      shape('feeder-b','line','Bay B feeder',585,155,1,300),
      shape('feeder-c','line','Bay C feeder',900,155,1,300),
      shape('cb-a','breaker','CB Bay A',247,265,46,72,'#184034','#6be0af','','BayA/XCBR1.Pos.stVal'),
      shape('cb-b','breaker','CB Bay B',562,265,46,72,'#184034','#6be0af','','BayB/XCBR1.Pos.stVal'),
      shape('cb-c','breaker','CB Bay C',877,265,46,72,'#184034','#6be0af','','BayC/XCBR1.Pos.stVal'),
      shape('label-a','text','Bay A label',231,483,125,24,'#e1ebf0','#e1ebf0','BAY A'),
      shape('label-b','text','Bay B label',546,483,125,24,'#e1ebf0','#e1ebf0','BAY B'),
      shape('label-c','text','Bay C label',861,483,125,24,'#e1ebf0','#e1ebf0','BAY C')
    ]}]};
}
export function makeId(prefix:string):string {
  return prefix+'-'+(globalThis.crypto?.randomUUID?.() ??
    (Date.now().toString(36)+Math.random().toString(36).slice(2)));
}
export function newShape(kind:ShapeKind,count:number):Shape {
  if (!kinds.has(kind)) throw new Error('Unsupported shape');
  const offset=(count%12)*17;
  return {id:makeId('shape'),kind,name:kind[0]!.toUpperCase()+kind.slice(1),
    x:180+offset,y:200+offset,width:kind==='line'?180:kind==='text'?200:100,
    height:kind==='line'?1:kind==='text'?34:75,fill:'#30536e',stroke:'#84c8dc',
    text:kind==='text'?'New label':'',tagId:''};
}
export function newSymbol(symbolId:string,count:number):Shape {
  const symbol=findSymbol(symbolId);
  if(!symbol)throw new Error('Unknown symbol identifier');
  return {...newShape('rect',count),kind:'symbol',name:symbol.label,
    symbolId:symbol.id,width:86,height:86,fill:'#30536e',stroke:'#84c8dc',
    animation:'none',...(findDynamicSymbol(symbolId)?{pointMode:'double-point' as const}:{})};
}
export function insertShape(p:Project,s:Shape):Project {
  if (!isShape(s)) throw new Error('Invalid shape');
  const active=p.pages.find(page=>page.id===p.activePageId);
  if (!active || active.shapes.length>=2000 || active.shapes.some(x=>x.id===s.id))
    throw new Error('Shape limit or duplicate ID');
  return {...p,pages:p.pages.map(page=>page.id===p.activePageId?
    {...page,shapes:[...page.shapes,s]}:page)};
}
export type ShapeEdit=Partial<Pick<Shape,'name'|'x'|'y'|'width'|'height'|'fill'|'stroke'|'text'|'tagId'|'animation'|'visualRule'|'threshold'|'partRules'|'pointMode'>>;
export function editShape(p:Project,id:string,edit:ShapeEdit):Project {
  return {...p,pages:p.pages.map(page=>page.id===p.activePageId?
    {...page,shapes:page.shapes.map(s=>{
      if (s.id!==id) return s;
      const next={...s,...edit};
      if (!isShape(next)) throw new Error('Invalid shape change');
      return next;
    })}:page)};
}
export function deleteShape(p:Project,id:string):Project {
  return {...p,pages:p.pages.map(page=>page.id===p.activePageId?
    {...page,shapes:page.shapes.filter(s=>s.id!==id)}:page)};
}
export function createPage(p:Project):Project {
  if (p.pages.length>=64) throw new Error('Maximum 64 pages');
  const id=makeId('page');
  return {...p,activePageId:id,
    pages:[...p.pages,{id,name:'Page '+(p.pages.length+1),shapes:[]}]};
}
