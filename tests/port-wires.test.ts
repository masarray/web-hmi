import test from 'node:test';
import assert from 'node:assert/strict';
import {CB_ROTATING} from '../src/app/editor/dynamic-symbol.ts';
import {migrateDynamicSymbolV1,parseVectorSymbol} from '../src/app/editor/symbol-studio-model.ts';
import {initialProject,newVectorInstance,insertShape,parseProject,
  deleteShape,editShape} from '../src/app/editor/document.ts';
import {deleteObjects,moveObjects} from '../src/app/editor/selection-ops.ts';
import {connectPorts,removeWire,portWorldPosition,portLocalPosition,
  resolveWireSegments,validatePageWires,orthogonalWirePath} from
  '../src/app/editor/port-wires.ts';

const fixture=()=>{
  const def=parseVectorSymbol({...migrateDynamicSymbolV1(CB_ROTATING),
    id:'user-wired-switch',name:'Switch With Ports'});
  let project={...initialProject(),vectorSymbols:[def]};
  const a={...newVectorInstance(def,1),x:200,y:120,width:80,height:80};
  const b={...newVectorInstance(def,2),x:550,y:400,width:120,height:80};
  project=insertShape(project,a);
  project=insertShape(project,b);
  return {project,def,a,b};
};
const render=(p:ReturnType<typeof fixture>['project'])=>
  resolveWireSegments(p,p.pages[0]!,s=>s);
test('create topology by IDs; report exact SVG meet letterbox port anchors',()=>{
  const {project,a,b,def}=fixture();
  const connected=connectPorts(project,
    {shapeId:a.id,portId:'bottom'},{shapeId:b.id,portId:'top'},'wire-1');
  assert.equal(connected.pages[0]!.wires?.length,1);
  assert.deepEqual(render(connected)[0]!.from,[240,120+96*.8]);
  // Symbol B 120x80 uses 0.8 scale, centered by 20 px on X.
  assert.deepEqual(portLocalPosition(def,b,'top'),[60,3.2]);
  assert.deepEqual(render(connected)[0]!.to,[610,403.2]);
  assert.equal(render(connected)[0]!.path,'M 240 196.8 L 240 300 L 610 300 L 610 403.2');
  const moved=moveObjects(connected,[a.id,b.id],20,-15);
  const after=render(moved)[0]!;
  assert.deepEqual(after.from,[260,181.8]);
  assert.deepEqual(after.to,[630,388.2]);
  assert.equal(after.wire.id,'wire-1');
  assert.equal(after.wire.from.shapeId,a.id);
  const resized=editShape(moved,a.id,{width:200,height:100});
  const p=render(resized)[0]!;
  assert.deepEqual(p.from,portWorldPosition(resized,resized.pages[0]!.shapes.find(x=>x.id===a.id)!,
    'bottom',{x:220,y:105,width:200,height:100}));
  assert.notEqual(p.from[0],after.from[0]);
});
test('reject dangling/missing port, duplicates/reverse-duplicate and same-symbol edge',()=>{
  const {project,a,b}=fixture();
  const from={shapeId:a.id,portId:'top'},to={shapeId:b.id,portId:'bottom'};
  let p=connectPorts(project,from,to,'wire-1');
  assert.throws(()=>connectPorts(p,to,from,'wire-2'),/duplicate/i);
  assert.throws(()=>connectPorts(p,from,to,'wire-1'),/duplicate/i);
  assert.throws(()=>connectPorts(p,from,{shapeId:b.id,portId:'missing'},'wire-2'),/dangling/i);
  assert.throws(()=>connectPorts(p,from,{shapeId:b.id,portId:'__proto__'},'wire-2'),/dangling/i);
  assert.throws(()=>connectPorts(p,from,{shapeId:b.id,portId:'constructor'},'wire-2'),/dangling/i);
  assert.throws(()=>connectPorts(p,from,{shapeId:a.id,portId:'bottom'},'wire-2'),/Invalid/);
  assert.throws(()=>connectPorts(p,from,{shapeId:'not-a-shape',portId:'top'},'wire-2'),/dangling/i);
  const exported=JSON.parse(JSON.stringify(p));
  assert.deepEqual(parseProject(exported).pages[0]!.wires,p.pages[0]!.wires);
  exported.pages[0].wires[0].to.portId='deleted';
  assert.throws(()=>parseProject(exported),/dangling|Invalid/i);
  exported.pages[0].wires[0].to.portId='bottom';
  exported.pages[0].wires[0].to.shapeId='cb-a';
  assert.throws(()=>parseProject(exported),/dangling|Invalid/i);
  p=removeWire(p,'wire-1');
  assert.deepEqual(p.pages[0]!.wires,[]);
  assert.equal(removeWire(p,'unknown'),p);
});
test('deleting an attached shape cleans topology atomically; old projects stay valid',()=>{
  const {project,a,b}=fixture();
  const p=connectPorts(project,{shapeId:a.id,portId:'bottom'},
    {shapeId:b.id,portId:'top'},'wire-1');
  const d=deleteShape(p,a.id);
  assert.deepEqual(d.pages[0]!.wires,[]);
  assert.equal(d.pages[0]!.shapes.some(x=>x.id===a.id),false);
  const m=deleteObjects(p,[b.id]);
  assert.deepEqual(m.pages[0]!.wires,[]);
  assert.deepEqual(parseProject(initialProject()),initialProject());
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(p))).pages[0]!.wires,p.pages[0]!.wires);
  const missingLibrary={...p,vectorSymbols:[]};
  assert.throws(()=>parseProject(missingLibrary),/Invalid|dangling/);
});
test('ports do not move with animated blades, invalid numeric routes fail closed',()=>{
  const {project,a}=fixture();
  const p1=portWorldPosition(project,a,'top',a);
  const p2=portWorldPosition(project,a,'top',a);
  assert.deepEqual(p1,p2);
  assert.equal(orthogonalWirePath([0,10],[30,10]),'M 0 10 L 30 10');
  assert.equal(orthogonalWirePath([10,0],[10,30]),'M 10 0 L 10 30');
  assert.throws(()=>orthogonalWirePath([0,Infinity],[10,20]),/Invalid/);
  assert.throws(()=>validatePageWires(project,project.pages[0]!,new Array(1001)),/Invalid/);
});
