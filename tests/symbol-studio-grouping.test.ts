import test from 'node:test';
import assert from 'node:assert/strict';
import {CB_ROTATING} from '../src/app/editor/dynamic-symbol.ts';
import {migrateDynamicSymbolV1,type VectorSymbol,type GroupNode} from
  '../src/app/editor/symbol-studio-model.ts';
import {SymbolEditHistory,applySymbolEdit} from '../src/app/editor/symbol-studio-commands.ts';
import {nodeLocations,groupVectorNodes,ungroupVectorNode,
  duplicateVectorSubtree,transformFromAffine} from '../src/app/editor/symbol-studio-grouping.ts';
import {projectVectorFrame} from '../src/app/editor/vector-runtime.ts';

const initial=():VectorSymbol=>migrateDynamicSymbolV1(CB_ROTATING);
const frame=(doc:VectorSymbol,value=1)=>projectVectorFrame(doc,'double-point',{
  tagId:'S1',value,quality:'GOOD',sequence:1,receivedAtMs:1000},1100,true,true);
const coords=(doc:VectorSymbol,value=1)=>
  frame(doc,value).rows.map(r=>({id:r.node.id,style:r.style,
    matrix:[r.matrix.a,r.matrix.b,r.matrix.c,r.matrix.d,r.matrix.e,r.matrix.f]}));
function equalFrames(a:ReturnType<typeof coords>,b:ReturnType<typeof coords>):void{
  // Grouping legitimately turns noncontiguous siblings into one drawing layer.
  // Compare exact appearance by stable ID, independently of z-order.
  a=[...a].sort((x,y)=>x.id.localeCompare(y.id));
  b=[...b].sort((x,y)=>x.id.localeCompare(y.id));
  assert.deepEqual(a.map(x=>x.id),b.map(x=>x.id));
  a.forEach((x,i)=>{
    assert.deepEqual(x.style,b[i]!.style);
    x.matrix.forEach((n,j)=>assert.ok(Math.abs(n-b[i]!.matrix[j]!)<1e-7,
      `node ${x.id}: matrix field ${j} differed`));
  });
}
test('Ctrl+G creates one nested group with stable IDs and intact state overrides',()=>{
  const source=initial();
  const after=groupVectorNodes(source,['upper','blade'],'group_one','Breaker');
  assert.equal(after.nodes.length,2);
  const grp=after.nodes[0] as GroupNode;
  assert.equal(grp.kind,'group');
  assert.deepEqual(grp.children.map(x=>x.id),['upper','blade']);
  assert.equal(nodeLocations(after).get('blade')?.parentId,'group_one');
  assert.equal(after.states.find(x=>x.id==='OPEN')?.overrides.blade?.transform?.rotation,-60);
  for(const v of [0,1,2,3])equalFrames(coords(source,v),coords(after,v));
});
test('Ungroup preserves rotated group geometry and distinct OPEN/CLOSED appearances',()=>{
  const group=groupVectorNodes(initial(),['upper','blade'],'group_one','Breaker');
  const before=applySymbolEdit(group,{type:'replace',
    node:{...group.nodes[0]!,transform:{...group.nodes[0]!.transform,
      x:19,y:12,rotation:28}} as GroupNode});
  const withState=applySymbolEdit(before,{type:'state-override',
    nodeId:'group_one',stateId:'CLOSED',
    patch:{transform:{rotation:45,x:29},visible:true}});
  const flat=ungroupVectorNode(withState,'group_one');
  assert.equal(flat.nodes.length,3);
  assert.equal(nodeLocations(flat).has('group_one'),false);
  for(const v of [0,1,2,3])equalFrames(coords(withState,v),coords(flat,v));
  assert.equal(flat.states.every(s=>!s.overrides.group_one),true);
});
test('Ungroup preserves group visibility, including state-only visibility',()=>{
  const grouped=groupVectorNodes(initial(),['upper','blade'],'group_one');
  const hidden=applySymbolEdit(grouped,{type:'replace',
    node:{...grouped.nodes[0]!,visible:false} as GroupNode});
  const exception=applySymbolEdit(hidden,{type:'state-override',
    nodeId:'group_one',stateId:'CLOSED',patch:{visible:true}});
  const flat=ungroupVectorNode(exception,'group_one');
  assert.deepEqual(frame(exception,1).rows.map(x=>x.node.id),frame(flat,1).rows.map(x=>x.node.id));
  assert.deepEqual(frame(exception,2).rows.map(x=>x.node.id),frame(flat,2).rows.map(x=>x.node.id));
});
test('Nested group copy preserves child IDs uniqueness, paint rules and both state transforms',()=>{
  const group=groupVectorNodes(initial(),['upper','blade'],'group_one');
  const copied=duplicateVectorSubtree(group,'group_one',
    {group_one:'group_copy',upper:'upper_copy',blade:'blade_copy'});
  assert.equal(nodeLocations(copied).get('blade_copy')?.parentId,'group_copy');
  assert.equal(copied.nodes.length,3);
  assert.equal(copied.states.find(s=>s.id==='OPEN')?.overrides.blade_copy?.transform?.rotation,-60);
  assert.equal(copied.states.find(s=>s.id==='CLOSED')?.overrides.blade_copy?.style?.stroke,'#65d7aa');
  assert.equal(copied.nodes[1]?.kind,'group');
  assert.equal((copied.nodes[1] as GroupNode).transform.x,10);
  assert.throws(()=>duplicateVectorSubtree(group,'group_one',
    {group_one:'group_copy',upper:'upper',blade:'blade_copy'}),/distinct ID/);
});
test('Grouping requires siblings; transformed ungroup fails safely when it would shear',()=>{
  const group=groupVectorNodes(initial(),['upper','blade'],'group_one');
  assert.throws(()=>groupVectorNodes(group,['group_one','blade'],'other_group'),/same parent/);
  const child=group.nodes[0] as GroupNode;
  const changed=applySymbolEdit(group,{type:'replace',
    node:{...child,transform:{...child.transform,rotation:30,scaleX:2}}});
  assert.throws(()=>ungroupVectorNode(changed,'group_one'),/sheared/);
  assert.throws(()=>transformFromAffine({a:0,b:0,c:0,d:0,e:0,f:0},[0,0]),/singular/);
});
test('Group, nested duplicate and ungroup are atomic Undo/Redo history actions',()=>{
  const history=new SymbolEditHistory(initial());
  assert.equal(history.execute({type:'group',nodeIds:['upper','blade'],
    groupId:'group_one',name:'Electrical CB'}),true);
  assert.equal(history.canUndo,true);
  assert.equal(history.execute({type:'duplicate',nodeId:'group_one',
    newIds:{group_one:'group_copy',upper:'upper_copy',blade:'blade_copy'}}),true);
  assert.equal(history.document.nodes.length,3);
  assert.equal(history.undo(),true);
  assert.equal(history.document.nodes.length,2);
  assert.equal(history.execute({type:'ungroup',groupId:'group_one'}),true);
  assert.equal(history.document.nodes.length,3);
  assert.equal(history.undo(),true);
  assert.equal(history.document.nodes[0]?.kind,'group');
  assert.equal(history.undo(),true);
  assert.equal(history.document.nodes.length,3);
  assert.equal(history.redo(),true);
  assert.equal(history.document.nodes[0]?.kind,'group');
});
