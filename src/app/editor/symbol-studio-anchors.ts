/**
 * Independent electrical ports and rotation anchors for Symbol Studio.
 * Ports are in definition viewBox coordinates and never follow moving blades.
 * Pivots are node-local and affect the active state's node transform.
 */
import {parseVectorSymbol,type VectorSymbol,type Vector2,type VectorNode,
  type VectorTransform} from './symbol-studio-model.ts';
import {nodeToWorld,worldToNode} from './symbol-studio-geometry.ts';

const finite=(n:number)=>Number.isFinite(n)&&Math.abs(n)<=20000;
export function boundPort(p:Vector2,viewBox:Vector2,snap=false):Vector2{
  if(!p.every(finite))throw Error('Invalid port position');
  const grid=(n:number)=>snap?Math.round(n/5)*5:n;
  return [Math.min(viewBox[0],Math.max(0,grid(p[0]))),
    Math.min(viewBox[1],Math.max(0,grid(p[1])))];
}
/** Deterministic nearest port; a label lookup alone never changes connectivity. */
export function nearestPort(doc:Pick<VectorSymbol,'ports'>,point:Vector2,
  radius=6):{id:string;point:Vector2}|null{
  if(!point.every(Number.isFinite)||!Number.isFinite(radius)||radius<=0)
    throw Error('Invalid port snapping distance');
  let best:{id:string;point:Vector2}|null=null,dist=radius*radius;
  for(const [id,pos] of Object.entries(doc.ports)){
    const dx=pos[0]-point[0],dy=pos[1]-point[1],d=dx*dx+dy*dy;
    if(d<=dist){best={id,point:pos};dist=d;}
  }
  return best;
}
export function setPort(doc:VectorSymbol,id:string,position:Vector2):VectorSymbol{
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id))throw Error('Invalid port label');
  if(!Object.hasOwn(doc.ports,id)&&Object.keys(doc.ports).length>=24)
    throw Error('Maximum 24 connection ports');
  return parseVectorSymbol({...doc,ports:{...doc.ports,
    [id]:boundPort(position,doc.viewBox)}});
}
export function deletePort(doc:VectorSymbol,id:string):VectorSymbol{
  if(!Object.hasOwn(doc.ports,id))throw Error('Unknown electrical port');
  const ports={...doc.ports};
  delete ports[id];return parseVectorSymbol({...doc,ports});
}
export function renamePort(doc:VectorSymbol,id:string,nextId:string):VectorSymbol{
  if(!Object.hasOwn(doc.ports,id))throw Error('Unknown electrical port');
  if(id===nextId)return doc;
  if(Object.hasOwn(doc.ports,nextId))throw Error('Duplicate port label');
  const ports:Record<string,Vector2>={};
  for(const [key,value] of Object.entries(doc.ports))
    ports[key===id?nextId:key]=value;
  return parseVectorSymbol({...doc,ports});
}
/**
 * Moving the handle changes a node's rotation center without unexpectedly
 * shifting its current BASE pose. Its per-state rotation still pivots around
 * the newly selected point; this is the behavior needed for CB/DS blades.
 */
export function reanchorNode(node:VectorNode,nextPivot:Vector2):VectorNode{
  if(!nextPivot.every(finite))throw Error('Invalid rotation pivot');
  const t=node.transform;
  const rad=t.rotation*Math.PI/180;
  const cos=Math.cos(rad),sin=Math.sin(rad);
  const a=cos*t.scaleX,b=sin*t.scaleX,c=-sin*t.scaleY,d=cos*t.scaleY;
  const dx=t.pivot[0]-nextPivot[0],dy=t.pivot[1]-nextPivot[1];
  const transform:VectorTransform={...t,
    x:t.x+(1-a)*dx-c*dy,
    y:t.y-b*dx+(1-d)*dy,
    pivot:[...nextPivot]};
  return {...node,transform};
}
export function reanchorFromWorld(doc:VectorSymbol,id:string,world:Vector2,
  grid=false):VectorNode{
  const find=(list:readonly VectorNode[]):VectorNode|undefined=>{
    for(const node of list){
      if(node.id===id)return node;
      if(node.kind==='group'){
        const found=find(node.children);
        if(found)return found;
      }
    }
    return undefined;
  };
  const node=find(doc.nodes);
  if(!node)throw Error('Unknown rotation target');
  const local=worldToNode(doc,id,world);
  const snapped:gridAware=grid?[
    Math.round(local[0]/5)*5,Math.round(local[1]/5)*5]:local;
  return reanchorNode(node,snapped);
}
type gridAware=Vector2;
export function pivotWorld(doc:VectorSymbol,id:string):Vector2{
  const find=(list:readonly VectorNode[]):VectorNode|undefined=>{
    for(const node of list){
      if(node.id===id)return node;
      if(node.kind==='group'){
        const found=find(node.children);
        if(found)return found;
      }
    }
    return undefined;
  };
  const node=find(doc.nodes);
  if(!node)throw Error('Unknown pivot target');
  return nodeToWorld(doc,id,node.transform.pivot);
}
