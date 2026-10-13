/**
 * Symbol Studio V2: strictly declarative scene graph and per-node visual states.
 * Standalone authoring contract; V1 project/runtime stay unmodified during S0.
 * No arbitrary SVG markup, executable scripts, CSS selectors or external URLs.
 */
import {parseDynamicSymbol,type DynamicSymbol} from './dynamic-symbol.ts';
import {effectiveQuality,type TagSample,type TagQuality} from './visual-runtime.ts';

export type Vector2=readonly [number,number];
export type NodeKind='group'|'line'|'rect'|'ellipse'|'path'|'text';
export type SignalEncoding='single-point'|'double-point';
export interface VectorStyle {
  readonly fill:string;readonly stroke:string;
  readonly strokeWidth:number;readonly opacity:number;
}
export interface VectorTransform {
  readonly x:number;readonly y:number;readonly rotation:number;
  readonly scaleX:number;readonly scaleY:number;readonly pivot:Vector2;
}
interface NodeBase {
  readonly id:string;readonly name:string;readonly visible:boolean;
  readonly transform:VectorTransform;
}
export interface GroupNode extends NodeBase {
  readonly kind:'group';readonly children:readonly VectorNode[];
}
export interface LineNode extends NodeBase {
  readonly kind:'line';readonly style:VectorStyle;
  readonly x1:number;readonly y1:number;readonly x2:number;readonly y2:number;
}
export interface RectNode extends NodeBase {
  readonly kind:'rect';readonly style:VectorStyle;
  readonly x:number;readonly y:number;readonly width:number;readonly height:number;
}
export interface EllipseNode extends NodeBase {
  readonly kind:'ellipse';readonly style:VectorStyle;
  readonly cx:number;readonly cy:number;readonly rx:number;readonly ry:number;
}
export interface PathNode extends NodeBase {
  readonly kind:'path';readonly style:VectorStyle;readonly d:string;
}
export interface TextNode extends NodeBase {
  readonly kind:'text';readonly style:VectorStyle;
  readonly x:number;readonly y:number;readonly text:string;
}
export type VectorNode=GroupNode|LineNode|RectNode|EllipseNode|PathNode|TextNode;
export interface NodeOverride {
  readonly style?:Partial<VectorStyle>;
  readonly transform?:Partial<VectorTransform>;
  readonly visible?:boolean;
  readonly text?:string;
}
export interface VectorState {
  readonly id:string;readonly label:string;
  readonly overrides:Readonly<Record<string,NodeOverride>>;
}
export interface VectorSymbol {
  readonly format:'web-hmi-vector-symbol';readonly version:2;
  readonly id:string;readonly name:string;
  readonly viewBox:Vector2;
  readonly nodes:readonly VectorNode[];
  readonly ports:Readonly<Record<string,Vector2>>;
  readonly states:readonly VectorState[];
  readonly initialStateId:string;
  readonly badStateId:string;
  readonly profiles:{
    readonly singlePoint:readonly [string,string];
    readonly doublePoint:readonly [string,string,string,string];
  };
}
export interface FrameNode {
  readonly id:string;readonly kind:NodeKind;
  readonly visible:boolean;readonly transform:VectorTransform;
  readonly style?:VectorStyle;readonly text?:string;
}
export interface VectorFrame {
  readonly quality:TagQuality|'UNBOUND';
  readonly stateId:string;
  readonly status:string;readonly warning:boolean;
  readonly nodes:ReadonlyMap<string,FrameNode>;
}
const idPattern=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const colorPattern=/^#[A-Fa-f0-9]{6}$/;
const allowedCommands=/^[MLHVCSQTAZmlhvcsqtaz0-9+.,\s\-eE]+$/;
const forbiddenPath=/[^MLHVCSQTAZmlhvcsqtaz0-9+.,\s\-eE]/;
const obj=(v:unknown):v is Record<string,unknown> =>
  v!==null&&typeof v==='object'&&!Array.isArray(v);
const number=(v:unknown,min:number,max:number):v is number=>
  typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const validId=(v:unknown):v is string=>
  typeof v==='string'&&idPattern.test(v);
const validName=(v:unknown,max=80):v is string=>
  typeof v==='string'&&v.trim().length>0&&v.length<=max;
const validColor=(v:unknown):v is string=>
  v==='none'||(typeof v==='string'&&colorPattern.test(v));
function point(value:unknown,min=-20000,max=20000):Vector2{
  if(!Array.isArray(value)||value.length!==2||
    !number(value[0],min,max)||!number(value[1],min,max))
    throw Error('Invalid vector coordinates');
  return [value[0],value[1]];
}
function num(value:unknown,name:string,min=-20000,max=20000):number{
  if(!number(value,min,max))throw Error('Invalid '+name);
  return value;
}
function cleanStyle(value:unknown,partial=false):Partial<VectorStyle>{
  if(!obj(value))throw Error('Invalid vector style');
  const fields=['fill','stroke','strokeWidth','opacity'];
  if(Object.keys(value).some(k=>!fields.includes(k)))throw Error('Unsupported style field');
  if(!partial&&fields.some(k=>value[k]===undefined))throw Error('Missing style field');
  const out:Record<string,number|string>={};
  if(value.fill!==undefined){
    if(!validColor(value.fill))throw Error('Invalid fill color');
    out.fill=value.fill;
  }
  if(value.stroke!==undefined){
    if(!validColor(value.stroke))throw Error('Invalid stroke color');
    out.stroke=value.stroke;
  }
  if(value.strokeWidth!==undefined)out.strokeWidth=num(value.strokeWidth,'stroke width',0,100);
  if(value.opacity!==undefined)out.opacity=num(value.opacity,'opacity',0,1);
  return out as unknown as Partial<VectorStyle>;
}
function cleanTransform(value:unknown,partial=false):Partial<VectorTransform>{
  if(!obj(value))throw Error('Invalid transform');
  const fields=['x','y','rotation','scaleX','scaleY','pivot'];
  if(Object.keys(value).some(k=>!fields.includes(k)))throw Error('Unsupported transform field');
  if(!partial&&fields.some(k=>value[k]===undefined))throw Error('Missing transform field');
  const out:Record<string,number|Vector2>={};
  if(value.x!==undefined)out.x=num(value.x,'translation X');
  if(value.y!==undefined)out.y=num(value.y,'translation Y');
  if(value.rotation!==undefined)out.rotation=num(value.rotation,'rotation',-3600,3600);
  if(value.scaleX!==undefined)out.scaleX=num(value.scaleX,'scale X',-100,100);
  if(value.scaleY!==undefined)out.scaleY=num(value.scaleY,'scale Y',-100,100);
  if(value.pivot!==undefined)out.pivot=point(value.pivot);
  return out as Partial<VectorTransform>;
}
const style=(v:unknown)=>cleanStyle(v) as VectorStyle;
const transform=(v:unknown)=>cleanTransform(v) as VectorTransform;

function parseNodes(input:unknown,seen:Set<string>,depth:number):VectorNode[]{
  if(!Array.isArray(input)||depth>8)throw Error('Invalid symbol hierarchy');
  const nodes:VectorNode[]=[];
  for(const raw of input){
    if(!obj(raw)||!validId(raw.id)||seen.has(raw.id)||
      !validName(raw.name)||typeof raw.visible!=='boolean'||!obj(raw.transform))
      throw Error('Invalid or duplicate vector node');
    seen.add(raw.id);
    if(seen.size>128)throw Error('Too many vector nodes');
    const base={id:raw.id,name:raw.name,visible:raw.visible,transform:transform(raw.transform)};
    if(raw.kind==='group'){
      if(!Array.isArray(raw.children)||raw.children.length<1)throw Error('Empty vector group');
      nodes.push({...base,kind:'group',children:parseNodes(raw.children,seen,depth+1)});
      continue;
    }
    const graphic={...base,style:style(raw.style)};
    if(raw.kind==='line'){
      nodes.push({...graphic,kind:'line',x1:num(raw.x1,'x1'),y1:num(raw.y1,'y1'),
        x2:num(raw.x2,'x2'),y2:num(raw.y2,'y2')});
    }else if(raw.kind==='rect'){
      nodes.push({...graphic,kind:'rect',x:num(raw.x,'rect X'),y:num(raw.y,'rect Y'),
        width:num(raw.width,'rect width',0.01,20000),
        height:num(raw.height,'rect height',0.01,20000)});
    }else if(raw.kind==='ellipse'){
      nodes.push({...graphic,kind:'ellipse',cx:num(raw.cx,'cx'),cy:num(raw.cy,'cy'),
        rx:num(raw.rx,'rx',0.01,20000),ry:num(raw.ry,'ry',0.01,20000)});
    }else if(raw.kind==='path'){
      if(typeof raw.d!=='string'||raw.d.length<3||raw.d.length>4096||
        !allowedCommands.test(raw.d)||forbiddenPath.test(raw.d)||
        !/[MLml]/.test(raw.d)||!Number.isFinite(Number(raw.d.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/)?.[0])))
        throw Error('Unsafe or invalid vector path');
      nodes.push({...graphic,kind:'path',d:raw.d});
    }else if(raw.kind==='text'){
      if(typeof raw.text!=='string'||raw.text.length>240)throw Error('Invalid vector text');
      nodes.push({...graphic,kind:'text',x:num(raw.x,'text X'),y:num(raw.y,'text Y'),
        text:raw.text});
    }else throw Error('Unsupported vector primitive');
  }
  return nodes;
}
function cleanOverride(input:unknown,kind:NodeKind):NodeOverride {
  if(!obj(input)||Object.keys(input).some(k=>!['style','transform','visible','text'].includes(k)))
    throw Error('Invalid state override');
  if(input.visible!==undefined&&typeof input.visible!=='boolean')throw Error('Invalid visibility');
  if(input.text!==undefined&&(kind!=='text'||typeof input.text!=='string'||input.text.length>240))
    throw Error('Text override requires text primitive');
  if(input.style!==undefined&&kind==='group')throw Error('Group cannot have paint override');
  return {...(input.style!==undefined?{style:cleanStyle(input.style,true)}:{}),
    ...(input.transform!==undefined?{transform:cleanTransform(input.transform,true)}:{}),
    ...(input.visible!==undefined?{visible:input.visible as boolean}:{}),
    ...(input.text!==undefined?{text:input.text as string}:{})};
}
export function indexVectorNodes(doc:Pick<VectorSymbol,'nodes'>):Map<string,VectorNode>{
  const indexed=new Map<string,VectorNode>();
  const walk=(items:readonly VectorNode[])=>{
    for(const node of items){indexed.set(node.id,node);if(node.kind==='group')walk(node.children);}
  };
  walk(doc.nodes);
  return indexed;
}
export function parseVectorSymbol(value:unknown):VectorSymbol{
  if(!obj(value)||value.format!=='web-hmi-vector-symbol'||value.version!==2||
    !validId(value.id)||!validName(value.name)||!Array.isArray(value.nodes))
    throw Error('Invalid Symbol Studio V2 header');
  const vb=point(value.viewBox,1,20000);
  const seen=new Set<string>();
  const nodes=parseNodes(value.nodes,seen,0);
  if(!nodes.length)throw Error('Symbol is empty');
  const indexed=indexVectorNodes({nodes});
  if(!obj(value.ports)||Object.keys(value.ports).length>24)throw Error('Invalid ports');
  const ports:Record<string,Vector2>={};
  for(const [id,raw] of Object.entries(value.ports)){
    if(!validId(id))throw Error('Invalid port name');
    ports[id]=point(raw);
  }
  if(!Array.isArray(value.states)||value.states.length<2||value.states.length>16)
    throw Error('Expected 2–16 symbol states');
  const states:VectorState[]=[];
  const stateIds=new Set<string>();
  let totalOverrides=0;
  for(const raw of value.states){
    if(!obj(raw)||!validId(raw.id)||stateIds.has(raw.id)||!validName(raw.label)||
      !obj(raw.overrides))throw Error('Invalid or duplicate state');
    const overrides:Record<string,NodeOverride>={};
    for(const [nodeId,ov] of Object.entries(raw.overrides)){
      const node=indexed.get(nodeId);
      if(!node)throw Error('State refers to a missing node');
      overrides[nodeId]=cleanOverride(ov,node.kind);
      if(++totalOverrides>512)throw Error('Too many state overrides');
    }
    stateIds.add(raw.id);
    states.push({id:raw.id,label:raw.label,overrides});
  }
  if(!validId(value.initialStateId)||!stateIds.has(value.initialStateId)||
    !validId(value.badStateId)||!stateIds.has(value.badStateId)||
    !obj(value.profiles))throw Error('Invalid initial/bad state or profile');
  const profile=(raw:unknown,size:number):string[]=>{
    if(!Array.isArray(raw)||raw.length!==size||
      !raw.every(s=>typeof s==='string'&&stateIds.has(s)))
      throw Error('Invalid numeric state profile');
    return [...raw] as string[];
  };
  const sp=profile(value.profiles.singlePoint,2);
  const dp=profile(value.profiles.doublePoint,4);
  return {format:'web-hmi-vector-symbol',version:2,id:value.id,name:value.name,
    viewBox:vb,nodes,ports,states,initialStateId:value.initialStateId,
    badStateId:value.badStateId,
    profiles:{singlePoint:sp as unknown as [string,string],
      doublePoint:dp as unknown as [string,string,string,string]}};
}
export function parseVectorSymbolJson(json:string):VectorSymbol{
  if(json.length>131072)throw Error('Symbol exceeds 128 KiB import budget');
  return parseVectorSymbol(JSON.parse(json) as unknown);
}
export function resolveVectorFrame(def:VectorSymbol,encoding:SignalEncoding,
  sample:TagSample|undefined,nowMs:number,preview:boolean,bound:boolean):VectorFrame{
  let quality:VectorFrame['quality']='UNBOUND';
  let stateId=def.initialStateId;
  if(preview&&bound){
    quality=effectiveQuality(sample,nowMs);
    if(quality!=='GOOD')stateId=def.badStateId;
    else{
      const raw=sample?.value;
      const value=raw===true?1:raw===false?0:raw;
      const values=encoding==='single-point'?def.profiles.singlePoint:def.profiles.doublePoint;
      stateId=typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<values.length?
        values[value]!:def.badStateId;
    }
  }
  const state=def.states.find(s=>s.id===stateId);
  if(!state)throw Error('Invalid resolved symbol state');
  const nodes=new Map<string,FrameNode>();
  const walk=(items:readonly VectorNode[])=>{
    for(const n of items){
      const override=state.overrides[n.id];
      const appearance:FrameNode={
        id:n.id,kind:n.kind,visible:override?.visible??n.visible,
        transform:{...n.transform,...(override?.transform??{})},
        ...(n.kind!=='group'?{style:{...n.style,...(override?.style??{})}}:{}),
        ...(n.kind==='text'?{text:override?.text??n.text}:{})
      };
      nodes.set(n.id,appearance);
      if(n.kind==='group')walk(n.children);
    }
  };
  walk(def.nodes);
  return {quality,stateId,status:quality==='GOOD'?stateId:quality==='UNBOUND'?'DESIGN':quality,
    warning:(quality!=='GOOD'&&quality!=='UNBOUND')||stateId===def.badStateId,
    nodes};
}
const identity:VectorTransform={x:0,y:0,rotation:0,scaleX:1,scaleY:1,pivot:[0,0]};
/** Lossless for V1 line geometry, pivot, blade angle/color, state truth table and ports. */
export function migrateDynamicSymbolV1(source:unknown):VectorSymbol{
  const old:DynamicSymbol=parseDynamicSymbol(source);
  const parts:VectorNode[]=old.parts.map(part=>({
    id:part.id,name:part.id,kind:'line',visible:true,
    x1:part.from[0],y1:part.from[1],x2:part.to[0],y2:part.to[1],
    style:{fill:'none',stroke:part.stroke,strokeWidth:part.strokeWidth,opacity:1},
    transform:{...identity,pivot:[...old.pivot]}
  }));
  const states=(Object.keys(old.states) as (keyof typeof old.states)[]).map(id=>({
    id,label:id,overrides:{
      [old.movingPartId]:{
        style:{stroke:old.states[id].color},
        transform:{rotation:old.states[id].angle}
      }
    }
  }));
  return parseVectorSymbol({
    format:'web-hmi-vector-symbol',version:2,id:old.id,name:old.name,
    viewBox:old.viewBox,nodes:parts,ports:old.ports,states,
    initialStateId:'OPEN',badStateId:'BAD_STATE',
    profiles:{singlePoint:old.profiles.singlePoint,
      doublePoint:old.profiles.doublePoint}
  });
}
export function importSymbolDefinition(value:unknown):VectorSymbol{
  if(obj(value)&&value.format==='web-hmi-symbol'&&value.version===1)
    return migrateDynamicSymbolV1(value);
  return parseVectorSymbol(value);
}
