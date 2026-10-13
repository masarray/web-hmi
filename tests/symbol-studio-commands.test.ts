import test from 'node:test';
import assert from 'node:assert/strict';
import {CB_ROTATING} from '../src/app/editor/dynamic-symbol.ts';
import {migrateDynamicSymbolV1,parseVectorSymbol,type VectorNode} from
  '../src/app/editor/symbol-studio-model.ts';
import {SymbolEditHistory,applySymbolEdit} from '../src/app/editor/symbol-studio-commands.ts';

const start=()=>migrateDynamicSymbolV1(CB_ROTATING);
const getBlade=(doc:ReturnType<typeof start>)=>
  doc.nodes.find(node=>node.id==='blade') as Extract<VectorNode,{kind:'line'}>;
test('state property patches merge independently and reset one attribute only',()=>{
  const startDoc=start();
  const added=applySymbolEdit(startDoc,{
    type:'state-override',nodeId:'blade',stateId:'OPEN',
    patch:{style:{opacity:0.5},transform:{rotation:-45}}
  });
  const ov=added.states.find(s=>s.id==='OPEN')!.overrides.blade!;
  assert.equal(ov.transform?.rotation,-45);
  assert.equal(ov.style?.stroke,'#e8b36c');
  assert.equal(ov.style?.opacity,0.5);
  const reset=applySymbolEdit(added,{
    type:'reset-override',nodeId:'blade',stateId:'OPEN',field:'style.stroke'
  });
  assert.equal(reset.states.find(s=>s.id==='OPEN')?.overrides.blade?.style?.stroke,undefined);
  assert.equal(reset.states.find(s=>s.id==='OPEN')?.overrides.blade?.style?.opacity,0.5);
  assert.equal(startDoc.states.find(s=>s.id==='OPEN')?.overrides.blade?.style?.stroke,'#e8b36c');
  assert.deepEqual(parseVectorSymbol(JSON.parse(JSON.stringify(reset))),reset);
});
test('gesture previews are always from pointerdown snapshot and produce one undo step',()=>{
  const original=start();
  const history=new SymbolEditHistory(original);
  history.beginGesture();
  assert.equal(history.canUndo,false);
  const blade=getBlade(history.document);
  const preview1={...blade,transform:{...blade.transform,x:30}};
  history.previewGesture({type:'replace',node:preview1});
  const preview2={...blade,transform:{...blade.transform,x:50}};
  history.previewGesture({type:'replace',node:preview2});
  assert.equal(getBlade(history.document).transform.x,50);
  assert.equal(history.canUndo,false);
  assert.equal(history.commitGesture(),true);
  assert.equal(history.canUndo,true);
  assert.equal(history.undo(),true);
  assert.equal(getBlade(history.document).transform.x,0);
  assert.equal(history.undo(),false);
  assert.equal(history.redo(),true);
  assert.equal(getBlade(history.document).transform.x,50);
});
test('Escape-style cancellation never changes persisted document or redo chain',()=>{
  const history=new SymbolEditHistory(start());
  history.beginGesture();
  const blade=getBlade(history.document);
  history.previewGesture({type:'replace',node:{...blade,x2:77}});
  assert.equal(getBlade(history.document).x2,77);
  history.cancelGesture();
  assert.equal(getBlade(history.document).x2,50);
  assert.equal(history.canUndo,false);
  assert.equal(history.document.format,'web-hmi-vector-symbol');
});
test('deleting nested parts removes their state references and rejects missing IDs',()=>{
  const original=start();
  const history=new SymbolEditHistory(original);
  assert.equal(history.execute({type:'remove',nodeId:'upper'}),true);
  assert.equal(history.document.nodes.some(n=>n.id==='upper'),false);
  assert.equal(history.undo(),true);
  assert.equal(history.document.nodes.length,3);
  assert.throws(()=>applySymbolEdit(original,{type:'remove',nodeId:'missing'}));
});
test('invalid edits cannot be committed, parent group and empty scene constraints enforced',()=>{
  const original=start();
  const history=new SymbolEditHistory(original);
  const blade=getBlade(history.document);
  assert.throws(()=>history.execute({type:'replace',node:{
    ...blade,style:{...blade.style,stroke:'javascript:alert(1)'}
  }}));
  assert.equal(history.canUndo,false);
  assert.throws(()=>history.execute({type:'insert',parentId:'blade',node:{
    ...blade,id:'new-blade'
  }}));
  assert.equal(history.document.nodes.length,3);
  assert.throws(()=>history.execute({type:'insert',node:{...blade,id:'blade'}}));
});
test('state edit cannot silently change a different state or the base geometry',()=>{
  const history=new SymbolEditHistory(start());
  const old=JSON.stringify(history.document.nodes);
  const oldClosed=JSON.stringify(history.document.states.find(s=>s.id==='CLOSED'));
  history.execute({type:'state-override',nodeId:'blade',stateId:'OPEN',
    patch:{style:{stroke:'#3399ff'},transform:{rotation:75}}});
  assert.equal(JSON.stringify(history.document.nodes),old);
  assert.equal(JSON.stringify(history.document.states.find(s=>s.id==='CLOSED')),oldClosed);
  assert.equal(history.document.states.find(s=>s.id==='OPEN')?.overrides.blade?.transform?.rotation,75);
});
