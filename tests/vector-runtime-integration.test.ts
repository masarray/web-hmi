import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CB_ROTATING} from '../src/app/editor/dynamic-symbol.ts';
import {migrateDynamicSymbolV1,parseVectorSymbol,
  type VectorSymbol} from '../src/app/editor/symbol-studio-model.ts';
import {projectVectorFrame,symbolDimensions} from '../src/app/editor/vector-runtime.ts';
import {initialProject,parseProject,newVectorInstance,insertShape} from '../src/app/editor/document.ts';
const source=():VectorSymbol=>parseVectorSymbol({...migrateDynamicSymbolV1(CB_ROTATING),
  id:'user-unique-v2',name:'My Switch'});
const tag=(value:number,quality:'GOOD'|'BAD'|'UNCERTAIN'='GOOD')=>({
  tagId:'BayA/XCBR1.Pos.stVal',value,quality,sequence:2,receivedAtMs:1000
});
test('V2 library project export roundtrip retains exact vector geometry and bindings',()=>{
  const def=source();
  const p=initialProject();
  const first={...newVectorInstance(def,1),tagId:'BayA/XCBR1.Pos.stVal'};
  const second={...newVectorInstance(def,2),tagId:'BayB/XCBR1.Pos.stVal'};
  const candidate=insertShape(insertShape({...p,vectorSymbols:[def]},first),second);
  const roundtrip=parseProject(JSON.parse(JSON.stringify(candidate)));
  assert.deepEqual(roundtrip.vectorSymbols,[def]);
  const placed=roundtrip.pages[0]!.shapes.slice(-2);
  assert.notEqual(placed[0]!.id,placed[1]!.id);
  assert.equal(placed[0]!.symbolId,placed[1]!.symbolId);
  assert.deepEqual(placed.map(s=>s.tagId),['BayA/XCBR1.Pos.stVal','BayB/XCBR1.Pos.stVal']);
  assert.deepEqual(parseProject(initialProject()),initialProject());
  assert.throws(()=>parseProject({...candidate,vectorSymbols:[]}),/Invalid/);
  assert.throws(()=>parseProject({...candidate,vectorSymbols:[def,def]}),/Duplicate/);
  assert.throws(()=>parseProject({...candidate,customSymbols:[
    {...CB_ROTATING,id:def.id}],vectorSymbols:[def]}),/Duplicate/);
});
test('V2 renderer keeps separate SP/DP states and never represents BAD as closed',()=>{
  const def=source(),view=(v:number)=>projectVectorFrame(def,'double-point',
    tag(v),1100,true,true);
  assert.equal(view(0).frame.stateId,'INTERMEDIATE');
  assert.equal(view(1).frame.stateId,'OPEN');
  assert.equal(view(2).frame.stateId,'CLOSED');
  assert.equal(view(3).frame.stateId,'BAD_STATE');
  const blade=(v:number)=>view(v).rows.find(r=>r.node.id==='blade')!;
  assert.equal(blade(1).style.stroke,'#e8b36c');
  assert.equal(blade(2).style.stroke,'#65d7aa');
  assert.equal(view(2).frame.warning,false);
  const bad=projectVectorFrame(def,'double-point',tag(2,'BAD'),1100,true,true);
  assert.equal(bad.frame.stateId,'BAD_STATE');
  assert.equal(bad.frame.warning,true);
  assert.equal(bad.rows.find(x=>x.node.id==='blade')?.style.stroke,'#fc7187');
  const stale=projectVectorFrame(def,'double-point',tag(2),10000,true,true);
  assert.equal(stale.frame.status,'STALE');
  assert.equal(stale.frame.stateId,'BAD_STATE');
  assert.deepEqual(symbolDimensions(def),[100,100]);
});
test('V2 runtime composes nested transforms and filters invisible children',()=>{
  const original=source();
  const closed=original.states.map(s=>s.id==='CLOSED'?{
    ...s,overrides:{...s.overrides,lower:{visible:false}}
  }:s);
  const nested=parseVectorSymbol({...original,
    nodes:[{kind:'group',id:'assembly',name:'Subassembly',visible:true,
      transform:{x:12,y:9,rotation:90,scaleX:1,scaleY:1,pivot:[0,0]},
      children:original.nodes}],states:closed});
  const result=projectVectorFrame(nested,'double-point',tag(2),1100,true,true);
  assert.equal(result.rows.length,2);
  assert.equal(result.rows.find(x=>x.node.id==='blade')?.matrix.e,12);
  assert.equal(result.rows.find(x=>x.node.id==='blade')?.matrix.f,9);
});
