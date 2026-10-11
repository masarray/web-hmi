import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CB_ROTATING,composeLineSymbol,parseDynamicSymbol,resolveDynamicState} from
  '../src/app/editor/dynamic-symbol.ts';
import {initialProject,parseProject,newSymbol,insertShape} from '../src/app/editor/document.ts';

const sample=(value:number|null,quality:'GOOD'|'BAD'|'STALE'='GOOD')=>({
  tagId:'Bay/XCBR1.Pos.stVal',value,quality,sequence:1,receivedAtMs:1000
});

test('single point maps 0 OPEN, 1 CLOSED and does not treat invalid as truthy',()=>{
  for(const [value,expected] of [[0,'OPEN'],[1,'CLOSED'],[2,'BAD_STATE']] as const){
    const out=resolveDynamicState(CB_ROTATING,'single-point',sample(value),1100,true,true);
    assert.equal(out.state,expected);
  }
});
test('IEC Dbpos 0/1/2/3 resolves distinct states, not active/idle',()=>{
  const states=['INTERMEDIATE','OPEN','CLOSED','BAD_STATE'];
  for(let v=0;v<4;v++){
    const out=resolveDynamicState(CB_ROTATING,'double-point',sample(v),1100,true,true);
    assert.equal(out.state,states[v]);
  }
});
test('unknown, stale and bad data fail closed without guessed open/close',()=>{
  const missing=resolveDynamicState(CB_ROTATING,'double-point',undefined,1100,true,true);
  assert.equal(missing.status,'STALE');
  assert.equal(missing.state,'BAD_STATE');
  const bad=resolveDynamicState(CB_ROTATING,'double-point',sample(2,'BAD'),1100,true,true);
  assert.equal(bad.status,'BAD');
  assert.equal(bad.state,'BAD_STATE');
  const expired=resolveDynamicState(CB_ROTATING,'double-point',sample(2),5000,true,true);
  assert.equal(expired.status,'STALE');
  assert.equal(expired.animate,false);
});
test('dynamic import rejects script markup, out-of-range pivot and duplicate parts',()=>{
  assert.deepEqual(parseDynamicSymbol(CB_ROTATING).profiles.doublePoint,
    ['INTERMEDIATE','OPEN','CLOSED','BAD_STATE']);
  assert.throws(()=>parseDynamicSymbol({...CB_ROTATING,parts:[{
    id:'blade',kind:'script',from:[0,0],to:[1,1],stroke:'#111111',strokeWidth:1
  }]}));
  assert.throws(()=>parseDynamicSymbol({...CB_ROTATING,pivot:[999,999]}));
  assert.throws(()=>parseDynamicSymbol({...CB_ROTATING,parts:[
    CB_ROTATING.parts[0],CB_ROTATING.parts[0]]}));
});
test('project v1 roundtrip preserves custom symbol geometry and instance binding',()=>{
  const custom=composeLineSymbol([
    {id:'leg',x:50,y:50,width:1,height:60,stroke:'#8cabb7'},
    {id:'blade',x:51,y:75,width:30,height:1,stroke:'#8cabb7'}
  ],'Switch custom','blade',[51,75],-60);
  assert.equal(parseDynamicSymbol(custom).parts.length,2);
  const project=initialProject();
  const shape={...newSymbol('cb-rotating',project.pages[0]!.shapes.length),
    symbolId:custom.id,name:'Switch custom',tagId:'Bay/XCBR1.Pos.stVal'};
  const candidate=insertShape({...project,customSymbols:[custom]},shape);
  const roundtrip=parseProject(JSON.parse(JSON.stringify(candidate)));
  assert.equal(roundtrip.customSymbols?.[0]?.id,custom.id);
  assert.equal(roundtrip.pages[0]?.shapes.at(-1)?.pointMode,'double-point');
  assert.throws(()=>parseProject({...candidate,customSymbols:[]}));
  assert.doesNotThrow(()=>parseProject(initialProject()));
});
