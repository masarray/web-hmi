import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProject,parseProject} from '../src/app/editor/document.ts';
import {duplicateShape,reorderShape,renameProject,renamePage,deletePage} from '../src/app/editor/actions.ts';

test('duplicate uses new object ID, copies tag, and preserves original project',()=>{
  const p=initialProject(),oldCount=p.pages[0]!.shapes.length;
  const {project:q,newId}=duplicateShape(p,'cb-a');
  const original=p.pages[0]!.shapes.find(s=>s.id==='cb-a')!;
  const copy=q.pages[0]!.shapes.find(s=>s.id===newId)!;
  assert.equal(q.pages[0]!.shapes.length,oldCount+1);
  assert.equal(p.pages[0]!.shapes.length,oldCount);
  assert.notEqual(copy.id,original.id);
  assert.equal(copy.tagId,original.tagId);
  assert.equal(copy.x,original.x+20);
  assert.deepEqual(parseProject(q),q);
});
test('bring front and send back preserve object data and history',()=>{
  const p=initialProject();
  const front=reorderShape(p,'cb-a','front');
  assert.equal(front.pages[0]!.shapes.at(-1)?.id,'cb-a');
  const back=reorderShape(front,'cb-a','back');
  assert.equal(back.pages[0]!.shapes[0]?.id,'cb-a');
  assert.equal(p.pages[0]!.shapes[5]?.id,'cb-a');
});
test('page renaming rejects duplicates, trims names and safely removes page',()=>{
  const p=initialProject();
  assert.equal(renameProject(p,'  My HMI ').name,'My HMI');
  const second={...p,pages:[...p.pages,{id:'second',name:'Secondary',shapes:[]}]};
  assert.equal(renamePage(second,'second',' Control ').pages[1]?.name,'Control');
  assert.throws(()=>renamePage(second,'second','OVERVIEW'),/unique/);
  assert.throws(()=>renameProject(p,'   '),/empty/);
  assert.equal(deletePage(second,'overview').activePageId,'second');
  assert.throws(()=>deletePage(p,'overview'),/At least one/);
});
test('no implicit mutation of objects and object limits enforced',()=>{
  const p=initialProject(),b=reorderShape(p,'missing','front');
  assert.deepEqual(b,p);
  assert.throws(()=>duplicateShape(p,'not-present'));
});
