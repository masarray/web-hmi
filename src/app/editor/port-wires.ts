/**
 * HMI wire topology is referential, not a second collection of freehand line
 * geometries. Ports are fixed in V2 viewBox coordinates, and endpoint world
 * positions are resolved from shape placement and size at render time.
 *
 * Avoids hidden per-frame mutation, duplicate tag polling and "broken wire"
 * artifacts after moving/resizing a symbol.
 */
import type {Project,Page,Shape} from './document.ts';
import type {VectorSymbol,Vector2} from './symbol-studio-model.ts';
export interface WireTerminal {readonly shapeId:string;readonly portId:string;}
export interface PortWire {
  readonly id:string;readonly from:WireTerminal;readonly to:WireTerminal;
}
export interface WireSegment {
  readonly wire:PortWire;readonly from:Vector2;readonly to:Vector2;
  readonly path:string;
}
export interface ShapeRect {readonly x:number;readonly y:number;
  readonly width:number;readonly height:number;}
const idValid=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(s);
const validShape=(p:Page,id:string)=>p.shapes.find(s=>s.id===id);
export function portDefinition(project:Pick<Project,'vectorSymbols'>,
  shape:Shape):VectorSymbol|undefined{
  return shape.kind==='symbol'?project.vectorSymbols?.find(x=>x.id===shape.symbolId):undefined;
}
export function terminalValid(project:Pick<Project,'vectorSymbols'>,
  page:Page,term:WireTerminal):boolean{
  if(!term||!idValid(term.shapeId)||!idValid(term.portId))return false;
  const shape=validShape(page,term.shapeId);
  return !!shape&&!!portDefinition(project,shape)?.ports[term.portId];
}
function sameTerminal(a:WireTerminal,b:WireTerminal):boolean{
  return a.shapeId===b.shapeId&&a.portId===b.portId;
}
function unorderedSame(a:PortWire,b:PortWire):boolean{
  return (sameTerminal(a.from,b.from)&&sameTerminal(a.to,b.to))||
    (sameTerminal(a.from,b.to)&&sameTerminal(a.to,b.from));
}
/** No dangling endpoints, duplicate edge, self-loop or references to other pages. */
export function validatePageWires(project:Pick<Project,'vectorSymbols'>,
  page:Page,wires:unknown):PortWire[]{
  if(!Array.isArray(wires)||wires.length>1000)
    throw Error('Invalid HMI wire collection');
  const result:PortWire[]=[];
  const ids=new Set<string>();
  for(const input of wires){
    if(!input||typeof input!=='object'||Array.isArray(input))
      throw Error('Invalid HMI wire');
    const w=input as Partial<PortWire>;
    if(!idValid(w.id)||ids.has(w.id!)||!w.from||!w.to||
      !terminalValid(project,page,w.from)||!terminalValid(project,page,w.to)||
      sameTerminal(w.from,w.to)||w.from.shapeId===w.to.shapeId||
      result.some(existing=>unorderedSame(existing,w as PortWire)))
      throw Error('Invalid, duplicate, or dangling HMI wire');
    ids.add(w.id!);
    result.push({id:w.id!,from:{shapeId:w.from.shapeId,portId:w.from.portId},
      to:{shapeId:w.to.shapeId,portId:w.to.portId}});
  }
  return result;
}
export function connectPorts(project:Project,from:WireTerminal,to:WireTerminal,
  id:string):Project{
  const page=project.pages.find(p=>p.id===project.activePageId);
  if(!page)throw Error('No active page');
  const wires=page.wires??[];
  const validated=validatePageWires(project,page,[...wires,{id,from,to}]);
  return {...project,pages:project.pages.map(p=>p.id===page.id?
    {...p,wires:validated}:p)};
}
export function removeWire(project:Project,id:string):Project{
  const page=project.pages.find(p=>p.id===project.activePageId);
  if(!page||!page.wires?.some(w=>w.id===id))return project;
  return {...project,pages:project.pages.map(p=>p.id===page.id?
    {...p,wires:(p.wires??[]).filter(w=>w.id!==id)}:p)};
}
export function pruneDeletedShapeWires(page:Page,shapes:readonly Shape[]):Page{
  const keep=new Set(shapes.map(s=>s.id));
  const wires=page.wires?.filter(w=>keep.has(w.from.shapeId)&&keep.has(w.to.shapeId));
  return {...page,shapes:[...shapes],...(page.wires!==undefined?{wires}: {})};
}
/** SVG preserveAspectRatio=xMidYMid meet, matching the actual nested SVG. */
export function portLocalPosition(def:VectorSymbol,rect:Pick<ShapeRect,'width'|'height'>,
  portId:string):Vector2{
  const port=def.ports[portId];
  if(!port)throw Error('Missing electrical terminal '+portId);
  const scale=Math.min(rect.width/def.viewBox[0],rect.height/def.viewBox[1]);
  const ox=(rect.width-def.viewBox[0]*scale)/2;
  const oy=(rect.height-def.viewBox[1]*scale)/2;
  return [ox+port[0]*scale,oy+port[1]*scale];
}
export function portWorldPosition(project:Pick<Project,'vectorSymbols'>,
  shape:Shape,portId:string,rect:ShapeRect):Vector2{
  const def=portDefinition(project,shape);
  if(!def)throw Error('Wire endpoint is not a V2 symbol');
  const [x,y]=portLocalPosition(def,rect,portId);
  return [rect.x+x,rect.y+y];
}
/** Orthogonal single-elbow/dual-elbow route; no diagonal cable artifacts. */
export function orthogonalWirePath(from:Vector2,to:Vector2):string{
  const x=(n:number)=>Number(n.toFixed(3));
  const [x1,y1]=from,[x2,y2]=to;
  if(![x1,y1,x2,y2].every(Number.isFinite))throw Error('Invalid wire geometry');
  if(Math.abs(x2-x1)<.001||Math.abs(y2-y1)<.001)
    return `M ${x(x1)} ${x(y1)} L ${x(x2)} ${x(y2)}`;
  const mid=x((y1+y2)/2);
  return `M ${x(x1)} ${x(y1)} L ${x(x1)} ${mid} L ${x(x2)} ${mid} L ${x(x2)} ${x(y2)}`;
}
export function resolveWireSegments(project:Project,page:Page,
  rectFor:(shape:Shape)=>ShapeRect):WireSegment[]{
  if(!page.wires?.length)return [];
  const shapes=new Map(page.shapes.map(s=>[s.id,s]));
  return page.wires.map(w=>{
    const from=shapes.get(w.from.shapeId),to=shapes.get(w.to.shapeId);
    if(!from||!to)throw Error('Dangling HMI wire in project');
    const p1=portWorldPosition(project,from,w.from.portId,rectFor(from));
    const p2=portWorldPosition(project,to,w.to.portId,rectFor(to));
    return {wire:w,from:p1,to:p2,path:orthogonalWirePath(p1,p2)};
  });
}
