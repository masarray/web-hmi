/** Deterministic, zero-polling electrical wiring between V2 symbol ports. */
import type {Project,Shape} from './document.ts';
import type {VectorSymbol,Vector2} from './symbol-studio-model.ts';
export interface PortRef{readonly shapeId:string;readonly portId:string}
export interface PortWire{readonly id:string;readonly from:PortRef;readonly to:PortRef}
export interface RoutedWire extends PortWire{
  readonly fromPoint:Vector2;readonly toPoint:Vector2;readonly d:string;
}
const idOk=(id:unknown)=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(id);
const portExists=(port:PortRef,shapes:readonly Shape[],defs:Map<string,VectorSymbol>):boolean=>{
  const shape=shapes.find(s=>s.id===port.shapeId);
  return !!shape&&shape.kind==='symbol'&&
    !!defs.get(shape.symbolId??'')?.ports[port.portId];
};
export function validatePageWires(raw:unknown,shapes:readonly Shape[],
  definitions:readonly VectorSymbol[]):PortWire[]{
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>500)throw Error('Invalid wire catalog');
  const defs=new Map(definitions.map(d=>[d.id,d]));
  const seen=new Set<string>();
  return raw.map(x=>{
    if(!x||typeof x!=='object')throw Error('Invalid wire entry');
    const w=x as Record<string,unknown>;
    const from=w.from as Record<string,unknown>|undefined;
    const to=w.to as Record<string,unknown>|undefined;
    if(!idOk(w.id)||seen.has(w.id as string)||!from||!to||
      !idOk(from.shapeId)||!idOk(from.portId)||
      !idOk(to.shapeId)||!idOk(to.portId)||
      from.shapeId===to.shapeId||
      !portExists(from as unknown as PortRef,shapes,defs)||
      !portExists(to as unknown as PortRef,shapes,defs))
      throw Error('Invalid, dangling or duplicate electrical wire');
    seen.add(w.id as string);
    return {id:w.id as string,
      from:{shapeId:from.shapeId as string,portId:from.portId as string},
      to:{shapeId:to.shapeId as string,portId:to.portId as string}};
  });
}
export function wirePortWorld(shape:Shape,definition:VectorSymbol,portId:string,
  placement?:{x:number;y:number;width:number;height:number}):Vector2{
  const point=definition.ports[portId];
  if(!point)throw Error('Unknown wire terminal');
  const s=placement??shape;
  // match SVG preserveAspectRatio="xMidYMid meet", including unequal scales
  const scale=Math.min(s.width/definition.viewBox[0],s.height/definition.viewBox[1]);
  const padX=(s.width-definition.viewBox[0]*scale)/2;
  const padY=(s.height-definition.viewBox[1]*scale)/2;
  return [s.x+padX+point[0]*scale,s.y+padY+point[1]*scale];
}
export function routedPageWires(project:Project,
  placements:ReadonlyMap<string,{x:number;y:number;width:number;height:number}> =
    new Map()):RoutedWire[]{
  const page=project.pages.find(p=>p.id===project.activePageId);
  if(!page)return [];
  const defs=new Map((project.vectorSymbols??[]).map(d=>[d.id,d]));
  const shapes=new Map(page.shapes.map(s=>[s.id,s]));
  return (page.wires??[]).flatMap(w=>{
    const from=shapes.get(w.from.shapeId),to=shapes.get(w.to.shapeId);
    const left=from?defs.get(from.symbolId??''):undefined;
    const right=to?defs.get(to.symbolId??''):undefined;
    if(!from||!to||!left||!right)return [];
    const a=wirePortWorld(from,left,w.from.portId,placements.get(from.id));
    const b=wirePortWorld(to,right,w.to.portId,placements.get(to.id));
    const m=(a[0]+b[0])/2;
    // Orthogonal, deterministic polyline. Only endpoints are attached.
    return [{...w,fromPoint:a,toPoint:b,
      d:`M ${a[0]} ${a[1]} H ${m} V ${b[1]} H ${b[0]}`}];
  });
}
export function connectPorts(project:Project,from:PortRef,to:PortRef,id:string):Project{
  const page=project.pages.find(p=>p.id===project.activePageId);
  if(!page)throw Error('Missing active page');
  const next:PortWire={id,from,to};
  const wires=validatePageWires([...(page.wires??[]),next],page.shapes,project.vectorSymbols??[]);
  return {...project,pages:project.pages.map(p=>p.id===page.id?{...p,wires}:p)};
}
export function disconnectWire(project:Project,id:string):Project{
  return {...project,pages:project.pages.map(p=>p.id===project.activePageId?{
    ...p,wires:(p.wires??[]).filter(w=>w.id!==id)
  }:p)};
}
