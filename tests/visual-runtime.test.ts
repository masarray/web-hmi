import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProject,newSymbol,insertShape,editShape,parseProject} from '../src/app/editor/document.ts';
import {updateTagSample,evaluateVisual,evaluatePage,type TagSample,type TagTable,
  type TagQuality} from '../src/app/editor/visual-runtime.ts';

const base=()=>({...newSymbol('pumpgear',12),tagId:'Pump/Running',animation:'spin' as const});
function reading(value:TagSample['value'],quality:TagQuality='GOOD',sequence=1):TagSample{
  return {tagId:'Pump/Running',value,quality,sequence};
}
test('stale and missing samples never animate or masquerade as GOOD',()=>{
  const shape=base();
  assert.equal(evaluateVisual(shape,undefined,true).quality,'STALE');
  assert.equal(evaluateVisual(shape,undefined,true).animate,false);
  for(const quality of ['BAD','UNCERTAIN','STALE'] as TagQuality[]){
    const state=evaluateVisual(shape,reading(true,quality),true);
    assert.equal(state.quality,quality);
    assert.equal(state.animate,false);
    assert.equal(state.active,false);
    assert.equal(state.warning,true);
    assert.notEqual(state.stroke,shape.stroke);
  }
});
test('GOOD false, zero, true and nonzero map to idle and active deterministically',()=>{
  const shape=base();
  for(const val of [false,0,null]){
    const state=evaluateVisual(shape,reading(val),true);
    assert.equal(state.quality,'GOOD');
    assert.equal(state.active,false);
    assert.equal(state.animate,false);
    assert.equal(state.status,'IDLE');
  }
  for(const val of [true,1,-5]){
    const state=evaluateVisual(shape,reading(val),true);
    assert.equal(state.active,true);assert.equal(state.animate,true);
  }
});
test('threshold rule rejects under-range and accepts boundary',()=>{
  const shape={...base(),visualRule:'at-least' as const,threshold:10};
  assert.equal(evaluateVisual(shape,reading(9.99),true).animate,false);
  assert.equal(evaluateVisual(shape,reading(10),true).animate,true);
  assert.equal(evaluateVisual(shape,reading(true),true).active,false);
  assert.equal(evaluateVisual(shape,reading(100,'BAD'),true).animate,false);
});
test('sequence-monotonic updates never overwrite new samples',()=>{
  const empty:TagTable=new Map();
  const newer=updateTagSample(empty,reading(true,'GOOD',3));
  const same=updateTagSample(newer,reading(false,'BAD',3));
  const older=updateTagSample(newer,reading(false,'BAD',2));
  assert.equal(newer,same);assert.equal(newer,older);
  assert.equal(newer.get('Pump/Running')?.value,true);
  const changed=updateTagSample(newer,reading(false,'BAD',4));
  assert.equal(changed.get('Pump/Running')?.quality,'BAD');
  assert.equal(newer.get('Pump/Running')?.quality,'GOOD');
  assert.throws(()=>updateTagSample(empty,{...reading(1),tagId:'../../evil<script>'}));
  assert.throws(()=>updateTagSample(empty,reading(Infinity)));
});
test('new visualization properties persist safely without upgrading v1 schema',()=>{
  const p=initialProject(),s=base();
  const next=editShape(insertShape(p,s),s.id,{visualRule:'at-least',threshold:4});
  const restored=parseProject(JSON.parse(JSON.stringify(next)));
  const saved=restored.pages[0]!.shapes.at(-1)!;
  assert.equal(saved.visualRule,'at-least');
  assert.equal(saved.threshold,4);
  assert.equal(restored.schemaVersion,1);
  assert.deepEqual(parseProject(p),p);
  const tampered=structuredClone(restored);
  tampered.pages[0]!.shapes.at(-1)!.threshold=Infinity;
  assert.throws(()=>parseProject(tampered));
});
test('simulated tag state and save history are isolated',()=>{
  const shape=base();
  const p=insertShape(initialProject(),shape);
  const table=updateTagSample(new Map(),reading(true,'GOOD',1));
  const states=evaluatePage(p.pages[0]!.shapes,table,true);
  assert.equal(states.get(shape.id)?.animate,true);
  assert.equal(states.size,1);
  assert.equal('value' in p.pages[0]!.shapes.at(-1)!,false);
  assert.equal(JSON.stringify(p).includes('sequence'),false);
  assert.equal(evaluatePage(p.pages[0]!.shapes,table,false).get(shape.id)?.animate,false);
});
test('microbenchmark pure state calculation at 100/500/1000 objects, informational only',()=>{
  const table=updateTagSample(new Map(),reading(true));
  for(const n of [100,500,1000]){
    const shapes=Array.from({length:n},(_,i)=>({...base(),id:'sample-'+i}));
    const t0=performance.now();
    for(let step=0;step<60;step++){
      const states=evaluatePage(shapes,table,true);
      assert.equal(states.size,n);
    }
    const ms=+(performance.now()-t0).toFixed(2);
    console.log(JSON.stringify({benchmark:'CP06-visual-state',shapes:n,iterations:60,milliseconds:ms}));
  }
});
