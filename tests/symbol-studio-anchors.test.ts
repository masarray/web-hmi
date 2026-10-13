import test from 'node:test';
import assert from 'node:assert/strict';
import {CB_ROTATING} from '../src/app/editor/dynamic-symbol.ts';
import {migrateDynamicSymbolV1,indexVectorNodes,type VectorSymbol} from
  '../src/app/editor/symbol-studio-model.ts';
import {SymbolEditHistory,applySymbolEdit} from '../src/app/editor/symbol-studio-commands.ts';
import {setPort,deletePort,renamePort,nearestPort,boundPort,
  reanchorNode,reanchorFromWorld,pivotWorld} from '../src/app/editor/symbol-studio-anchors.ts';
import {groupVectorNodes} from '../src/app/editor/symbol-studio-grouping.ts';
import {nodeToWorld} from '../src/app/editor/symbol-studio-geometry.ts';
import {projectVectorFrame} from '../src/app/editor/vector-runtime.ts';

const doc=():VectorSymbol=>migrateDynamicSymbolV1(CB_ROTATING);
const line=(symbol:VectorSymbol)=>indexVectorNodes(symbol).get('blade')!;
test('bounded ports add, drag, rename, delete and serialize with original Symbol V2 schema',()=>{
  let a=setPort(doc(),'LineIn',[37.3,12.4]);
  assert.deepEqual(a.ports.LineIn,[37.3,12.4]);
  a=setPort(a,'LineIn',[-55,150]);
  assert.deepEqual(a.ports.LineIn,[0,100]);
  a=renamePort(a,'LineIn','Terminal_A');
  assert.equal(a.ports.LineIn,undefined);
  assert.deepEqual(a.ports.Terminal_A,[0,100]);
  assert.deepEqual(JSON.parse(JSON.stringify(a)).ports.Terminal_A,[0,100]);
  assert.throws(()=>renamePort(a,'Terminal_A','top'),/Duplicate/);
  assert.throws(()=>setPort(a,'bad label',[10,10]),/Invalid/);
  assert.throws(()=>setPort(a,'bad',[Infinity,1]),/Invalid/);
  assert.deepEqual(boundPort([27.1,31.8],[100,100],true),[25,30]);
  assert.deepEqual(nearestPort(a,[1,99],7)?.point,[0,100]);
  assert.equal(nearestPort(a,[40,40],7),null);
  a=deletePort(a,'Terminal_A');
  assert.equal(a.ports.Terminal_A,undefined);
  assert.throws(()=>deletePort(a,'Terminal_A'),/Unknown/);
});
test('24-port limit fails closed and undo stores drag as single transaction',()=>{
  let a=doc();
  // Existing two ports count against the shared 24-port quota.
  for(let n=1;n<=22;n++)a=setPort(a,'Port'+n,[n,n]);
  assert.equal(Object.keys(a.ports).length,24);
  assert.throws(()=>setPort(a,'TooMany',[30,30]),/Maximum/);
  const history=new SymbolEditHistory(doc());
  history.beginGesture();
  history.previewGesture({type:'set-port',id:'top',point:[10,15]});
  history.previewGesture({type:'set-port',id:'top',point:[42,25]});
  assert.equal(history.canUndo,false);
  history.commitGesture();
  assert.equal(history.document.ports.top?.[0],42);
  history.undo();
  assert.deepEqual(history.document.ports.top,doc().ports.top);
  history.redo();
  assert.deepEqual(history.document.ports.top,[42,25]);
  history.execute({type:'rename-port',id:'top',nextId:'A'});
  assert.deepEqual(history.document.ports.A,[42,25]);
  history.undo();
  assert.deepEqual(history.document.ports.top,[42,25]);
});
test('moving pivot preserves BASE geometry, but changes OPEN/CLOSED blade rotation hinge',()=>{
  const before=doc();
  const blade=line(before);
  const start=nodeToWorld(before,'blade',[blade.kind==='line'?blade.x1:0,
    blade.kind==='line'?blade.y1:0]);
  const renamed=reanchorFromWorld(before,'blade',nodeToWorld(before,'blade',[50,65]));
  const changed=applySymbolEdit(before,{type:'replace',node:renamed});
  const newStart=nodeToWorld(changed,'blade',[blade.kind==='line'?blade.x1:0,
    blade.kind==='line'?blade.y1:0]);
  assert.deepEqual(newStart,start);
  assert.deepEqual(line(changed).transform.pivot,[50,65]);
  const oldFrame=projectVectorFrame(before,'double-point',{
    tagId:'CB',value:1,quality:'GOOD',sequence:1,receivedAtMs:100},200,true,true);
  const newFrame=projectVectorFrame(changed,'double-point',{
    tagId:'CB',value:1,quality:'GOOD',sequence:1,receivedAtMs:100},200,true,true);
  assert.equal(oldFrame.frame.stateId,'OPEN');
  assert.equal(newFrame.frame.stateId,'OPEN');
  assert.notDeepEqual(oldFrame.rows.find(r=>r.node.id==='blade')?.matrix,
    newFrame.rows.find(r=>r.node.id==='blade')?.matrix);
  assert.deepEqual(pivotWorld(changed,'blade'),[50,65]);
});
test('pivot reanchor remains stable on rotated-scaled nested groups and rejects invalid input',()=>{
  const original=doc();
  const group=groupVectorNodes(original,['upper','blade'],'MyGroup');
  const root=group.nodes.find(n=>n.id==='MyGroup')!;
  const transformed=applySymbolEdit(group,{type:'replace',node:{
    ...root,transform:{...root.transform,x:11,y:19,rotation:35,scaleX:1.4,scaleY:1.4}
  }});
  const old=line(transformed);
  const pos=nodeToWorld(transformed,'blade',[50,35]);
  const next=reanchorFromWorld(transformed,'blade',nodeToWorld(transformed,'blade',[45,45]));
  const result=applySymbolEdit(transformed,{type:'replace',node:next});
  const posAfter=nodeToWorld(result,'blade',[50,35]);
  assert.ok(Math.abs(posAfter[0]-pos[0])<1e-7);
  assert.ok(Math.abs(posAfter[1]-pos[1])<1e-7);
  assert.notDeepEqual(next.transform.pivot,old.transform.pivot);
  assert.throws(()=>reanchorNode(old,[Infinity,25]),/Invalid/);
});
test('rotated base pose is unchanged after moving its pivot',()=>{
  const old=line(doc());
  const rotated={...old,transform:{...old.transform,
    x:20,y:8,rotation:37,scaleX:1.5,scaleY:-1}};
  const next=reanchorNode(rotated,[18,59]);
  const sample=(t:typeof rotated.transform,p:[number,number]):[number,number]=>{
    const a=t.rotation*Math.PI/180,cos=Math.cos(a),sin=Math.sin(a);
    const x=(p[0]-t.pivot[0])*t.scaleX,y=(p[1]-t.pivot[1])*t.scaleY;
    return [t.x+t.pivot[0]+x*cos-y*sin,t.y+t.pivot[1]+x*sin+y*cos];
  };
  for(const p of [[0,0],[50,35],[100,100]] as [number,number][]){
    const a=sample(rotated.transform,p),b=sample(next.transform,p);
    assert.ok(Math.abs(a[0]-b[0])<1e-7);
    assert.ok(Math.abs(a[1]-b[1])<1e-7);
  }
});
