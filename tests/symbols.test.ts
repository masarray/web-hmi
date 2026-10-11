import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProject,newSymbol,insertShape,parseProject,editShape} from '../src/app/editor/document.ts';
import {HMI_SYMBOLS,findSymbol,filterSymbols} from '../src/app/editor/symbols.ts';
import {duplicateShape} from '../src/app/editor/actions.ts';

test('36 vetted, uniquely identified local SVGs with exact registry authority',()=>{
  assert.equal(HMI_SYMBOLS.length,36);
  assert.equal(new Set(HMI_SYMBOLS.map(s=>s.id)).size,36);
  for(const symbol of HMI_SYMBOLS){
    assert.ok(symbol.href.startsWith('assets/fuxa/'));
    assert.equal(findSymbol(symbol.id),symbol);
  }
});
test('symbol search and category filters work without dynamic URLs',()=>{
  assert.ok(filterSymbols('pump','Pumps').length>=5);
  assert.equal(filterSymbols('valve','Electrical').length,0);
  assert.equal(filterSymbols('MoToR').length,1);
  assert.equal(findSymbol('../evil.svg'),undefined);
});
test('symbol insert, animation, duplicate and JSON export/import preserve identity',()=>{
  const project=initialProject();
  const symbol=newSymbol('pumpcentri1',project.pages[0]!.shapes.length);
  const modified=editShape(insertShape(project,symbol),symbol.id,{animation:'spin',tagId:'pump/speed'});
  const duplicated=duplicateShape(modified,symbol.id);
  const imported=parseProject(JSON.parse(JSON.stringify(duplicated.project)));
  const inserted=imported.pages[0]!.shapes.find(s=>s.id===symbol.id)!;
  const copied=imported.pages[0]!.shapes.find(s=>s.id===duplicated.newId)!;
  assert.equal(inserted.symbolId,'pumpcentri1');
  assert.equal(inserted.animation,'spin');
  assert.equal(copied.animation,'spin');
  assert.equal(copied.tagId,'pump/speed');
  assert.notEqual(copied.id,inserted.id);
  assert.equal(project.pages[0]!.shapes.length,11);
});
test('import rejects invalid asset identifiers and animation modes',()=>{
  const p=initialProject();
  p.pages[0]!.shapes.push(newSymbol('tank1',12));
  const data=JSON.parse(JSON.stringify(p));
  data.pages[0].shapes.at(-1).symbolId='https://malicious.invalid/foo.svg';
  assert.throws(()=>parseProject(data));
  data.pages[0].shapes.at(-1).symbolId='tank1';
  data.pages[0].shapes.at(-1).animation='javascript:alert(1)';
  assert.throws(()=>parseProject(data));
});
test('old v1 project stays valid and does not acquire optional fields',()=>{
  const old=initialProject();
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(old))),old);
});
