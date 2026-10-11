import test from 'node:test';
import assert from 'node:assert/strict';
import {initialProject,parseProject} from '../src/app/editor/document.ts';
import {alignObjects,distributeObjects,moveObjects,deleteObjects} from '../src/app/editor/selection-ops.ts';

const at=(p:ReturnType<typeof initialProject>,id:string)=>p.pages[0]!.shapes.find(s=>s.id===id)!;

test('aligning 3 feeders snaps shared x while preserving original and other pages',()=>{
  const p=initialProject();
  const ids=['feeder-a','feeder-b','feeder-c'];
  const aligned=alignObjects(p,ids,'left');
  assert.equal(at(aligned,'feeder-b').x,270);
  assert.equal(at(aligned,'feeder-c').x,270);
  assert.equal(at(p,'feeder-c').x,900);
  assert.deepEqual(parseProject(aligned),aligned);
});
test('horizontal centers are evenly spaced with endpoints unchanged',()=>{
  const p=initialProject();
  const ids=['cb-a','cb-b','cb-c'];
  const changed=moveObjects(p,['cb-b'],130,0);
  const spread=distributeObjects(changed,ids,'horizontal');
  assert.equal(at(spread,'cb-a').x,at(p,'cb-a').x);
  assert.equal(at(spread,'cb-c').x,at(p,'cb-c').x);
  const first=at(spread,'cb-a'),middle=at(spread,'cb-b'),last=at(spread,'cb-c');
  const d1=(middle.x+middle.width/2)-(first.x+first.width/2);
  const d2=(last.x+last.width/2)-(middle.x+middle.width/2);
  assert.ok(Math.abs(d1-d2)<0.02);
});
test('batch move creates one atomic document change and retains bindings',()=>{
  const p=initialProject();
  const q=moveObjects(p,['cb-a','cb-b'],35,15);
  assert.equal(at(q,'cb-a').x,282);
  assert.equal(at(q,'cb-b').y,280);
  assert.equal(at(q,'cb-a').tagId,at(p,'cb-a').tagId);
  assert.equal(at(q,'cb-c').x,at(p,'cb-c').x);
  assert.notEqual(q.pages[0],p.pages[0]);
  assert.equal(moveObjects(p,[],5,5),p);
  assert.equal(moveObjects(p,['cb-a'],0,0),p);
});
test('delete selection leaves other pages intact and rejects stale page IDs',()=>{
  const p=initialProject();
  const q=deleteObjects(p,['cb-a','cb-b']);
  assert.equal(q.pages[0]!.shapes.length,p.pages[0]!.shapes.length-2);
  assert.equal(p.pages[0]!.shapes.length,11);
  assert.throws(()=>alignObjects(p,['cb-a','missing'],'left'),/another page/);
});
test('align operations are idempotent, preserve bounds, and work across all axes',()=>{
  const p=initialProject(),ids=['cb-a','cb-b','cb-c'];
  for(const kind of ['left','center','right','top','middle','bottom'] as const){
    const aligned=alignObjects(p,ids,kind);
    assert.deepEqual(alignObjects(aligned,ids,kind),aligned);
    assert.deepEqual(parseProject(aligned),aligned);
  }
  assert.equal(distributeObjects(p,['cb-a','cb-b'],'horizontal'),p);
});
