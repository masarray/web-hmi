/**
 * Symbol Studio interaction math. Deterministic, DOM-free coordinate engine
 * shared by the forthcoming SVG.js adapter and state preview.
 *
 * No native MouseEvent dependency; coordinates are normalized at the adapter.
 * World transforms compose across arbitrary nested groups, including rotation,
 * negative scale, custom pivots, and line endpoints with arbitrary slope.
 */
import {indexVectorNodes,type VectorSymbol,type VectorNode,type Vector2,
  type VectorTransform,type LineNode,type RectNode,type EllipseNode} from './symbol-studio-model.ts';

export interface Affine {readonly a:number;readonly b:number;readonly c:number;
  readonly d:number;readonly e:number;readonly f:number;}
export interface Bounds {readonly x:number;readonly y:number;
  readonly width:number;readonly height:number;}
export type EdgeHandle='nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
export type LineHandle='start'|'end';
export const IDENTITY:Affine={a:1,b:0,c:0,d:1,e:0,f:0};
const radians=(deg:number)=>deg*Math.PI/180;
const tolerance=1e-10;
export function product(A:Affine,B:Affine):Affine{
  return {a:A.a*B.a+A.c*B.b,b:A.b*B.a+A.d*B.b,
    c:A.a*B.c+A.c*B.d,d:A.b*B.c+A.d*B.d,
    e:A.a*B.e+A.c*B.f+A.e,f:A.b*B.e+A.d*B.f+A.f};
}
const move=(x:number,y:number):Affine=>({...IDENTITY,e:x,f:y});
const rotate=(deg:number):Affine=>{
  const cs=Math.cos(radians(deg)),sn=Math.sin(radians(deg));
  return {a:cs,b:sn,c:-sn,d:cs,e:0,f:0};
};
const scale=(x:number,y:number):Affine=>({a:x,b:0,c:0,d:y,e:0,f:0});
export function applyAffine(m:Affine,[x,y]:Vector2):Vector2{
  return [m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f];
}
export function inverseAffine(m:Affine):Affine{
  const det=m.a*m.d-m.b*m.c;
  if(!Number.isFinite(det)||Math.abs(det)<tolerance)
    throw Error('Cannot manipulate object with singular transform');
  return {a:m.d/det,b:-m.b/det,c:-m.c/det,d:m.a/det,
    e:(m.c*m.f-m.d*m.e)/det,f:(m.b*m.e-m.a*m.f)/det};
}
/** Translate -> pivot -> rotate -> scale -> unpivot in parent coordinates. */
export function transformMatrix(t:VectorTransform):Affine{
  const [px,py]=t.pivot;
  return product(product(product(product(
    move(t.x,t.y),move(px,py)),rotate(t.rotation)),
    scale(t.scaleX,t.scaleY)),move(-px,-py));
}
/** A vector node's transform includes all ancestor group transformations. */
export function worldMatrix(doc:Pick<VectorSymbol,'nodes'>,id:string):Affine{
  let target:Affine|undefined;
  const walk=(list:readonly VectorNode[],parent:Affine)=>{
    for(const node of list){
      const world=product(parent,transformMatrix(node.transform));
      if(node.id===id){target=world;return true;}
      if(node.kind==='group'&&walk(node.children,world))return true;
    }
    return false;
  };
  walk(doc.nodes,IDENTITY);
  if(!target)throw Error('Unknown scene node '+id);
  return target;
}
export function worldToNode(doc:Pick<VectorSymbol,'nodes'>,id:string,p:Vector2):Vector2{
  return applyAffine(inverseAffine(worldMatrix(doc,id)),p);
}
export function nodeToWorld(doc:Pick<VectorSymbol,'nodes'>,id:string,p:Vector2):Vector2{
  return applyAffine(worldMatrix(doc,id),p);
}
export function snapPoint([x,y]:Vector2,spacing:number,enabled=true):Vector2{
  if(!enabled)return [x,y];
  if(!Number.isFinite(spacing)||spacing<=0||spacing>1000)
    throw Error('Invalid grid spacing');
  return [Math.round(x/spacing)*spacing,Math.round(y/spacing)*spacing];
}
/** Model endpoints, not bounding box sizes, preserve diagonal and reversed lines. */
export function dragEndpoint(line:LineNode,handle:LineHandle,point:Vector2):LineNode{
  if(!point.every(Number.isFinite))throw Error('Non-finite endpoint');
  return handle==='start'?{...line,x1:point[0],y1:point[1]}:
    {...line,x2:point[0],y2:point[1]};
}
export function dragEndpointFromWorld(doc:VectorSymbol,lineId:string,
  handle:LineHandle,worldPoint:Vector2,grid=10,snap=false):LineNode{
  const node=indexVectorNodes(doc).get(lineId);
  if(!node||node.kind!=='line')throw Error('Not a vector line');
  const point=worldToNode(doc,lineId,snapPoint(worldPoint,grid,snap));
  return dragEndpoint(node,handle,point);
}
export function boundingHandles(bounds:Bounds,matrix:Affine):Record<EdgeHandle,Vector2>{
  const {x,y,width:w,height:h}=bounds;
  return {
    nw:applyAffine(matrix,[x,y]),
    n:applyAffine(matrix,[x+w/2,y]),
    ne:applyAffine(matrix,[x+w,y]),
    e:applyAffine(matrix,[x+w,y+h/2]),
    se:applyAffine(matrix,[x+w,y+h]),
    s:applyAffine(matrix,[x+w/2,y+h]),
    sw:applyAffine(matrix,[x,y+h]),
    w:applyAffine(matrix,[x,y+h/2])
  };
}
/** Resolve nearest visible handle within an on-screen radius, independent of zoom. */
export function hitHandle(worldPoint:Vector2,handles:Record<string,Vector2>,
  pixelsPerWorldUnit:number,radiusPx=9):string|null{
  if(!Number.isFinite(pixelsPerWorldUnit)||pixelsPerWorldUnit<=0||
    !Number.isFinite(radiusPx)||radiusPx<=0)throw Error('Invalid viewport scale');
  let match:string|null=null,nearest=radiusPx*radiusPx;
  for(const [id,pt] of Object.entries(handles)){
    const dx=(pt[0]-worldPoint[0])*pixelsPerWorldUnit;
    const dy=(pt[1]-worldPoint[1])*pixelsPerWorldUnit;
    const distance=dx*dx+dy*dy;
    if(distance<=nearest){nearest=distance;match=id;}
  }
  return match;
}
/**
 * Resize in local coordinates so the opposite edge stays fixed under rotation.
 * The pointer arrives as a world point and is mapped using the original matrix.
 */
export function resizeBounds(original:Bounds,handle:EdgeHandle,
  localPoint:Vector2,min=1):Bounds{
  const [px,py]=localPoint;
  if(!Number.isFinite(px)||!Number.isFinite(py)||!Number.isFinite(min)||min<=0)
    throw Error('Invalid resize pointer');
  let left=original.x,top=original.y;
  let right=original.x+original.width,bottom=original.y+original.height;
  if(handle.includes('w'))left=Math.min(px,right-min);
  if(handle.includes('e'))right=Math.max(px,left+min);
  if(handle.includes('n'))top=Math.min(py,bottom-min);
  if(handle.includes('s'))bottom=Math.max(py,top+min);
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function resizeRectFromWorld(doc:VectorSymbol,id:string,
  handle:EdgeHandle,worldPointer:Vector2,min=0.01):RectNode{
  const node=indexVectorNodes(doc).get(id);
  if(!node||node.kind!=='rect')throw Error('Resize target must be rectangle');
  const bounds=resizeBounds({x:node.x,y:node.y,width:node.width,height:node.height},
    handle,worldToNode(doc,id,worldPointer),min);
  return {...node,...bounds};
}
export function resizeEllipseFromWorld(doc:VectorSymbol,id:string,
  handle:EdgeHandle,worldPointer:Vector2,min=0.01):EllipseNode{
  const node=indexVectorNodes(doc).get(id);
  if(!node||node.kind!=='ellipse')throw Error('Resize target must be ellipse');
  const bounds=resizeBounds({x:node.cx-node.rx,y:node.cy-node.ry,
    width:node.rx*2,height:node.ry*2},
    handle,worldToNode(doc,id,worldPointer),min);
  return {...node,cx:bounds.x+bounds.width/2,cy:bounds.y+bounds.height/2,
    rx:bounds.width/2,ry:bounds.height/2};
}
function angleTo(center:Vector2,p:Vector2):number{
  return Math.atan2(p[1]-center[1],p[0]-center[0])*180/Math.PI;
}
/**
 * Angles derive from two world-space pointer positions, not a mutable previous
 * frame. Both stay stable with zoom and are one action in SymbolEditHistory.
 */
export function rotateAroundPivot(doc:VectorSymbol,id:string,startWorld:Vector2,
  currentWorld:Vector2,snap15=false):VectorTransform{
  const node=indexVectorNodes(doc).get(id);
  if(!node)throw Error('Unknown rotate target');
  const pivotWorld=nodeToWorld(doc,id,node.transform.pivot);
  const delta=angleTo(pivotWorld,currentWorld)-angleTo(pivotWorld,startWorld);
  if(!Number.isFinite(delta))throw Error('Invalid rotation delta');
  const next=node.transform.rotation+delta;
  return {...node.transform,rotation:snap15?Math.round(next/15)*15:next};
}
/** Translation uses the parent group coordinate system, not the object's own rotation. */
export function moveNodeFromWorld(doc:VectorSymbol,id:string,
  startWorld:Vector2,currentWorld:Vector2):VectorTransform{
  const node=indexVectorNodes(doc).get(id);
  if(!node)throw Error('Unknown move target');
  // Ancestor matrix excludes the node's own transform.
  let parentMatrix=IDENTITY,found=false;
  const walk=(list:readonly VectorNode[],world:Affine)=>{
    for(const child of list){
      if(child.id===id){parentMatrix=world;found=true;return true;}
      if(child.kind==='group'&&walk(child.children,
        product(world,transformMatrix(child.transform))))return true;
    }
    return false;
  };
  walk(doc.nodes,IDENTITY);
  if(!found)throw Error('Unknown node parent');
  const back=inverseAffine(parentMatrix);
  const a=applyAffine(back,startWorld),b=applyAffine(back,currentWorld);
  return {...node.transform,x:node.transform.x+b[0]-a[0],
    y:node.transform.y+b[1]-a[1]};
}
