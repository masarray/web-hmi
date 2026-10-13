import test from 'node:test';
import assert from 'node:assert/strict';
import {CB_ROTATING} from '../src/app/editor/dynamic-symbol.ts';
import {migrateDynamicSymbolV1,parseVectorSymbol,type VectorSymbol,
  type RectNode,type EllipseNode,type VectorNode} from '../src/app/editor/symbol-studio-model.ts';
import {SymbolEditHistory} from '../src/app/editor/symbol-studio-commands.ts';
import {IDENTITY,product,applyAffine,inverseAffine,transformMatrix,
  worldMatrix,worldToNode,nodeToWorld,hitHandle,boundingHandles,
  dragEndpointFromWorld,resizeRectFromWorld,resizeEllipseFromWorld,
  rotateAroundPivot,moveNodeFromWorld,snapPoint} from
  '../src/app/editor/symbol-studio-geometry.ts';

const make=()=>migrateDynamicSymbolV1(CB_ROTATING);
const baseTransform={x:0,y:0,rotation:0,scaleX:1,scaleY:1,pivot:[0,0] as const};
const paint={fill:'none',stroke:'#778899',strokeWidth:2,opacity:1};
const rect:RectNode={id:'panel',name:'Panel',kind:'rect',visible:true,transform:{
  ...baseTransform,rotation:90,pivot:[30,20]},style:paint,
  x:10,y:10,width:40,height:20};
const ellipse:EllipseNode={id:'ring',name:'Ring',kind:'ellipse',visible:true,
  transform:baseTransform,style:paint,cx:50,cy:40,rx:30,ry:20};
const withNodes=(nodes:VectorNode[]):VectorSymbol=>
  parseVectorSymbol({...make(),nodes});

const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('affine composition/inverse roundtrips rotated scaled group coordinates',()=>{
  const m=product(transformMatrix({
    x:85,y:-22,rotation:130,scaleX:-1.2,scaleY:1.5,pivot:[12,34]}),IDENTITY);
  const p:[number,number]=[-80,97];
  const result=applyAffine(inverseAffine(m),applyAffine(m,p));
  near(result[0],p[0]);near(result[1],p[1]);
  assert.throws(()=>inverseAffine({a:0,b:0,c:0,d:0,e:0,f:0}));
});
test('nested groups preserve endpoint hit geometry under rotation, pan and scale',()=>{
  const original=make();
  const group:VectorNode={kind:'group',id:'housing',name:'Switch',visible:true,
    transform:{...baseTransform,x:100,y:80,rotation:90,scaleX:1.5},
    children:[...original.nodes]};
  const doc=withNodes([group]);
  const coordinate:[number,number]=[-10,44];
  const world=nodeToWorld(doc,'blade',coordinate);
  const recovered=worldToNode(doc,'blade',world);
  near(recovered[0],coordinate[0]);near(recovered[1],coordinate[1]);
  const m=worldMatrix(doc,'blade');
  near(applyAffine(m,coordinate)[0],world[0]);
});
test('line endpoint edits independently preserve diagonal and backward line slope',()=>{
  const doc=make();
  const pointer=nodeToWorld(doc,'blade',[-20,95]);
  const line=dragEndpointFromWorld(doc,'blade','end',pointer);
  assert.equal(line.x1,50);assert.equal(line.y1,35);
  assert.equal(line.x2,-20);assert.equal(line.y2,95);
  const other=dragEndpointFromWorld(doc,'blade','start',[43,67],10,true);
  assert.deepEqual([other.x1,other.y1],[40,70]);
  assert.deepEqual(snapPoint([14.99,-11],5),[15,-10]);
});
test('all eight rectangle edge handles and ellipses are transform-consistent',()=>{
  const doc=withNodes([...make().nodes,rect,ellipse]);
  const handles=boundingHandles({x:rect.x,y:rect.y,width:rect.width,height:rect.height},
    worldMatrix(doc,rect.id));
  assert.equal(Object.keys(handles).length,8);
  assert.equal(hitHandle(handles.ne,handles,1.5),'ne');
  assert.equal(hitHandle([handles.ne[0]+20,handles.ne[1]],handles,1.5),null);
  const rightPointer=nodeToWorld(doc,'panel',[70,20]);
  const resized=resizeRectFromWorld(doc,'panel','e',rightPointer);
  assert.equal(resized.x,10);assert.equal(resized.y,10);
  near(resized.width,60);near(resized.height,20);
  const ellipsePointer=nodeToWorld(doc,'ring',[90,40]);
  const ring=resizeEllipseFromWorld(doc,'ring','e',ellipsePointer);
  near(ring.cx,55);near(ring.rx,35);near(ring.ry,20);
});
test('pivoted rotation and nested translation remain stable in world space',()=>{
  const doc=make(),pivot:[number,number]=[50,35];
  const p0=nodeToWorld(doc,'blade',[70,35]);
  const p1=nodeToWorld(doc,'blade',[50,55]);
  const next=rotateAroundPivot(doc,'blade',p0,p1,true);
  near(next.rotation,90);
  const moved=moveNodeFromWorld(doc,'blade',[10,10],[40,70]);
  near(moved.x,30);near(moved.y,60);
  const otherDoc=withNodes([{kind:'group',id:'rotated',name:'Group',
    visible:true,transform:{...baseTransform,rotation:90},
    children:[...doc.nodes]}]);
  const moved2=moveNodeFromWorld(otherDoc,'blade',[0,0],[20,0]);
  near(moved2.x,0);near(moved2.y,-20);
  assert.equal(pivot[0],50);
});
test('interactive endpoint drag cancels cleanly and commits only once',()=>{
  const history=new SymbolEditHistory(make());
  history.beginGesture();
  for(let x=20;x<=90;x+=10){
    const changed=dragEndpointFromWorld(history.document,'blade','end',[x,80]);
    history.previewGesture({type:'replace',node:changed});
  }
  assert.equal(history.canUndo,false);
  history.cancelGesture();
  assert.equal(history.canUndo,false);
  history.beginGesture();
  const end=dragEndpointFromWorld(history.document,'blade','end',[95,100]);
  history.previewGesture({type:'replace',node:end});
  assert.equal(history.commitGesture(),true);
  assert.equal(history.canUndo,true);
  history.undo();
  assert.equal(history.canUndo,false);
});
