import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProject,parseProject,newShape,insertShape,
  editShape,deleteShape,createPage} from '../src/app/editor/document.ts';

test('round-trip valid project with deterministic schema',()=>{
  const p=initialProject();
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))),p);
});
test('editing does not mutate history snapshot',()=>{
  const a=initialProject(),b=editShape(a,'cb-a',{x:350,tagId:'IED/XCBR1.Pos'});
  assert.equal(a.pages[0]!.shapes.find(s=>s.id==='cb-a')!.x,247);
  assert.equal(b.pages[0]!.shapes.find(s=>s.id==='cb-a')!.x,350);
});
test('insert and delete return original content without mutation',()=>{
  const a=initialProject(),s=newShape('rect',3);
  const b=insertShape(a,s),c=deleteShape(b,s.id);
  assert.equal(b.pages[0]!.shapes.length,a.pages[0]!.shapes.length+1);
  assert.deepEqual(c,a);
});
test('multi-page creation preserves original',()=>{
  const a=initialProject(),b=createPage(a);
  assert.equal(a.pages.length,1);assert.equal(b.pages.length,2);
  assert.equal(b.activePageId,b.pages[1]!.id);
});
test('invalid color and executable attributes are rejected',()=>{
  const a=initialProject() as any;
  a.pages[0].shapes[0].fill='url(javascript:alert(1))';
  assert.throws(()=>parseProject(a));
});
test('duplicate shapes, infinite coordinates and wrong schema are rejected',()=>{
  const a=initialProject();
  a.pages[0]!.shapes.push({...a.pages[0]!.shapes[0]!});
  assert.throws(()=>parseProject(a),/duplicate/);
  const b=initialProject();
  b.pages[0]!.shapes[0]!.x=Infinity;
  assert.throws(()=>parseProject(b));
  assert.throws(()=>parseProject({...initialProject(),schemaVersion:2}));
});
test('unknown imported fields are removed by parser',()=>{
  const dirty=JSON.parse(JSON.stringify(initialProject()));
  dirty.pages[0].shapes[0].onmouseover='alert(1)';
  const clean=parseProject(dirty);
  assert.equal('onmouseover' in clean.pages[0]!.shapes[0]!,false);
});
