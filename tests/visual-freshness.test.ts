import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProject,newSymbol,insertShape,editShape,parseProject} from '../src/app/editor/document.ts';
import {findProcessGraphic} from '../src/app/editor/process-graphics.ts';
import {effectiveQuality,evaluatePartAppearance,evaluateVisual,nextFreshnessDeadline,
  updateTagSample,STALE_AFTER_MS,type TagSample} from '../src/app/editor/visual-runtime.ts';

const reading=(tagId:string,value:boolean|number,receivedAtMs:number,quality:'GOOD'|'BAD'='GOOD'):TagSample=>
  ({tagId,value,quality,receivedAtMs,sequence:1});
const gear=()=>{
  const symbol=newSymbol('pumpgear',14);
  return {...symbol,tagId:'Plant/P1',animation:'spin' as const};
};

test('receive-time boundary is exact, missing time cannot claim healthy freshness',()=>{
  const sample=reading('Plant/P1',true,10000);
  assert.equal(effectiveQuality(sample,12999),'GOOD');
  assert.equal(effectiveQuality(sample,13000),'STALE');
  assert.equal(effectiveQuality(sample,10001),'GOOD');
  assert.equal(effectiveQuality({...sample,receivedAtMs:undefined},12000),'STALE');
  assert.equal(effectiveQuality({...sample,receivedAtMs:undefined}),'GOOD');
  assert.equal(effectiveQuality(undefined,12999),'STALE');
  assert.equal(effectiveQuality(reading('Plant/P1',true,9000,'BAD'),9001),'BAD');
  assert.equal(effectiveQuality(reading('Plant/P1',true,9000,'BAD'),12000),'STALE');
  assert.equal(STALE_AFTER_MS,3000);
});
test('one next-expiry calculation handles many tags, ignores expired and explicitly STALE',()=>{
  let table=new Map<string,TagSample>();
  table=updateTagSample(table,reading('a',true,1000)) as Map<string,TagSample>;
  table=updateTagSample(table,reading('b',true,2000)) as Map<string,TagSample>;
  table=updateTagSample(table,{...reading('c',false,1600),quality:'STALE'}) as Map<string,TagSample>;
  assert.equal(nextFreshnessDeadline(table,2500),4000);
  assert.equal(nextFreshnessDeadline(table,4000),5000);
  assert.equal(nextFreshnessDeadline(table,5000),null);
  assert.equal(nextFreshnessDeadline(new Map(),1000),null);
  assert.throws(()=>updateTagSample(new Map(),reading('a',true,-1)));
  assert.throws(()=>updateTagSample(new Map(),{...reading('a',true,0),receivedAtMs:NaN}));
});
test('per-part rules affect only selected geometry, no generic SVG code evaluation',()=>{
  const shape=gear(),graphic=findProcessGraphic('pumpgear')!;
  const state=evaluateVisual(shape,reading('Plant/P1',true,1000),true,1500);
  assert.equal(state.animate,true);
  const housing=evaluatePartAppearance(shape,graphic.parts[0]!,0,state,true);
  const rotor=evaluatePartAppearance(shape,graphic.parts[2]!,2,state,true);
  assert.equal(housing.spin,false);
  assert.equal(rotor.spin,true);
  const configured={...shape,partRules:[
    {partIndex:0,effect:'fixed' as const},
    {partIndex:1,effect:'state-color' as const},
    {partIndex:2,effect:'hide-idle' as const},
    {partIndex:3,effect:'spin-active' as const}
  ]};
  const fixed=evaluatePartAppearance(configured,graphic.parts[0]!,0,state,true);
  const colored=evaluatePartAppearance(configured,graphic.parts[1]!,1,state,true);
  const hiddenActive=evaluatePartAppearance(configured,graphic.parts[2]!,2,state,true);
  const spinner=evaluatePartAppearance(configured,graphic.parts[3]!,3,state,true);
  assert.equal(fixed.stroke,shape.stroke);
  assert.equal(colored.stroke,state.stroke);
  assert.equal(hiddenActive.visible,true);
  assert.equal(spinner.spin,true);
  const off=evaluateVisual(configured,reading('Plant/P1',false,1000),true,1500);
  assert.equal(evaluatePartAppearance(configured,graphic.parts[2]!,2,off,true).visible,false);
  assert.equal(evaluatePartAppearance(configured,graphic.parts[3]!,3,off,true).spin,false);
  const stale=evaluateVisual(configured,reading('Plant/P1',true,1000),true,4000);
  assert.equal(stale.quality,'STALE');
  assert.equal(evaluatePartAppearance(configured,graphic.parts[2]!,2,stale,true).visible,false);
  assert.equal(evaluatePartAppearance(configured,graphic.parts[3]!,3,stale,true).spin,false);
});
test('part rules serialize with v1 schema and reject unknown indices, actions, duplicates',()=>{
  const p=initialProject(),shape=gear();
  const changed=editShape(insertShape(p,shape),shape.id,{partRules:[
    {partIndex:2,effect:'state-color'},
    {partIndex:3,effect:'spin-active'}
  ]});
  const roundtrip=parseProject(JSON.parse(JSON.stringify(changed)));
  assert.equal(roundtrip.schemaVersion,1);
  assert.deepEqual(roundtrip,changed);
  for(const bad of [
    [{partIndex:99,effect:'fixed'}],
    [{partIndex:0,effect:'run-javascript'}],
    [{partIndex:0,effect:'fixed'},{partIndex:0,effect:'state-color'}],
    [{partIndex:-1,effect:'fixed'}]
  ]){
    const file=JSON.parse(JSON.stringify(changed));
    file.pages[0].shapes.at(-1).partRules=bad;
    assert.throws(()=>parseProject(file));
  }
  const malformed=JSON.parse(JSON.stringify(changed));
  malformed.pages[0].shapes.at(-1).partRules[0].onload='alert(1)';
  const cleaned=parseProject(malformed);
  assert.equal('onload' in cleaned.pages[0]!.shapes.at(-1)!.partRules![0]!,false);
});
test('thousand-symbol pure state/part check has bounded output and stable IDs',()=>{
  const graphic=findProcessGraphic('motor-simb')!;
  const shape={...newSymbol('motor-simb',0),tagId:'Plant/M',animation:'spin' as const};
  const sample=reading('Plant/M',true,1000);
  for(const count of [100,500,1000]){
    const began=performance.now();
    let active=0;
    for(let n=0;n<count;n++){
      const visual=evaluateVisual(shape,sample,true,1100);
      for(let i=0;i<graphic.parts.length;i++){
        if(evaluatePartAppearance(shape,graphic.parts[i]!,i,visual,true).spin)active++;
      }
    }
    assert.equal(active,count);
    console.log(JSON.stringify({benchmark:'CP06B-part-compute',count,ms:Math.round((performance.now()-began)*100)/100}));
  }
});
