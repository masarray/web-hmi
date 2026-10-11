import test from 'node:test';
import assert from 'node:assert/strict';
import {findProcessGraphic,PROCESS_GRAPHIC_COUNT} from '../src/app/editor/process-graphics.ts';
import {initialProject,newSymbol,insertShape,editShape,parseProject} from '../src/app/editor/document.ts';

test('curated process graphics are static inline geometry with known FUXA provenance',()=>{
  assert.equal(PROCESS_GRAPHIC_COUNT,6);
  for(const id of ['pumpgear','motor-simb','pumpjet','valve-cx','exchanger-tube','pumpvacuum']){
    const shape=findProcessGraphic(id);
    assert.ok(shape,id);
    assert.match(shape.viewBox,/^0 0 \d+ \d+$/);
    assert.ok(shape.parts.length>0);
    for(const part of shape.parts){
      assert.ok(part.kind==='path'||part.kind==='ellipse');
      if(part.kind==='path')assert.match(part.d,/^[\s\d.,+\-eEMmLlHhVvCcSsQqTtAaZz]+$/);
      else for(const n of [part.cx,part.cy,part.rx,part.ry])
        assert.ok(Number.isFinite(n)&&n>=0);
    }
  }
});
test('rotor annotations affect moving parts only',()=>{
  const gear=findProcessGraphic('pumpgear')!,motor=findProcessGraphic('motor-simb')!;
  assert.equal(gear.parts.length,4);
  assert.equal(gear.parts.filter(p=>p.rotor).length,2);
  assert.equal(motor.parts.filter(p=>p.rotor).length,1);
  assert.equal(motor.parts[0]?.rotor,undefined);
  assert.equal(findProcessGraphic('valve-cx')?.hasRotor,false);
  assert.equal(findProcessGraphic('pumpcentri1'),undefined);
});
test('process symbols retain chosen stroke, animation and tag metadata across JSON',()=>{
  const p=initialProject(),shape=newSymbol('pumpgear',10);
  const edited=editShape(insertShape(p,shape),shape.id,{stroke:'#ffcc00',animation:'spin',tagId:'Pump/Running'});
  const loaded=parseProject(JSON.parse(JSON.stringify(edited)));
  const stored=loaded.pages[0]!.shapes.find(s=>s.id===shape.id)!;
  assert.equal(stored.symbolId,'pumpgear');
  assert.equal(stored.animation,'spin');
  assert.equal(stored.stroke,'#ffcc00');
  assert.equal(stored.tagId,'Pump/Running');
  assert.deepEqual(parseProject(p),p);
});
test('untrusted arbitrary vector identifiers are rejected',()=>{
  const p=initialProject();
  p.pages[0]!.shapes.push(newSymbol('pumpgear',11));
  const untrusted=structuredClone(p);
  untrusted.pages[0]!.shapes.at(-1)!.symbolId='../x.svg';
  assert.throws(()=>parseProject(untrusted));
});
