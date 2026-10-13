import test from 'node:test';
import assert from 'node:assert/strict';
import {CB_ROTATING} from '../src/app/editor/dynamic-symbol.ts';
import {migrateDynamicSymbolV1,parseVectorSymbol} from '../src/app/editor/symbol-studio-model.ts';
import {initialProject,newVectorInstance,parseProject,editShape,deleteShape} from
  '../src/app/editor/document.ts';
import {connectPorts,disconnectWire,routedPageWires,wirePortWorld,
  validatePageWires} from '../src/app/editor/port-wires.ts';
import {moveObjects,deleteObjects} from '../src/app/editor/selection-ops.ts';

const setup=()=>{
  const definition=parseVectorSymbol({...migrateDynamicSymbolV1(CB_ROTATING),
    id:'user-attached-cb',name:'Attached Breaker'});
  const p=initialProject();
  const a={...newVectorInstance(definition,1),id:'attached-a',x:100,y:100,
    width:100,height:100};
  const b={...newVectorInstance(definition,2),id:'attached-b',x:410,y:280,
    width:180,height:120};
  return {definition,project:{...p,vectorSymbols:[definition],pages:[
    {...p.pages[0]!,shapes:[...p.pages[0]!.shapes,a,b]}]}};
};
test('ports maintain exact orthogonal attachment during move and resize',()=>{
  const {project,definition}=setup();
  const wired=connectPorts(project,{shapeId:'attached-a',portId:'bottom'},
    {shapeId:'attached-b',portId:'top'},'wire-1');
  const original=routedPageWires(wired)[0]!;
  assert.deepEqual(original.fromPoint,[150,196]);
  assert.deepEqual(original.toPoint,wirePortWorld(
    wired.pages[0]!.shapes.at(-1)!,definition,'top'));
  assert.match(original.d,/^M .* H .* V .* H .*$/);
  const moved=moveObjects(wired,['attached-a'],85,40);
  const afterward=routedPageWires(moved)[0]!;
  assert.deepEqual(afterward.fromPoint,[235,236]);
  assert.deepEqual(afterward.toPoint,original.toPoint);
  const resized=editShape(moved,'attached-b',{width:240,height:120});
  const now=routedPageWires(resized)[0]!;
  assert.notDeepEqual(now.toPoint,original.toPoint);
  assert.deepEqual(now.fromPoint,afterward.fromPoint);
  const draft=new Map([['attached-a',{x:355,y:225,width:100,height:100}]]);
  assert.deepEqual(routedPageWires(wired,draft)[0]!.fromPoint,[405,321]);
  assert.deepEqual(routedPageWires(wired),[original]);
});
test('wires survive project roundtrip, reject dangling names and keep backward compatibility',()=>{
  const {project}=setup();
  const wired=connectPorts(project,{shapeId:'attached-a',portId:'top'},
    {shapeId:'attached-b',portId:'bottom'},'wire-1');
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(wired))).pages[0]!.wires,
    wired.pages[0]!.wires);
  assert.equal(parseProject(initialProject()).pages[0]!.wires,undefined);
  assert.throws(()=>connectPorts(wired,{shapeId:'attached-a',portId:'invalid'},
    {shapeId:'attached-b',portId:'top'},'wire-2'),/Invalid/);
  assert.throws(()=>connectPorts(wired,{shapeId:'attached-a',portId:'top'},
    {shapeId:'attached-a',portId:'bottom'},'wire-2'),/Invalid/);
  assert.throws(()=>connectPorts(wired,{shapeId:'attached-a',portId:'top'},
    {shapeId:'attached-b',portId:'top'},'wire-1'),/Invalid/);
  const tampered=structuredClone(wired);
  (tampered.pages[0]!.wires![0]!.to as {shapeId:string;portId:string}).shapeId='deleted';
  assert.throws(()=>parseProject(tampered),/Invalid/);
  assert.throws(()=>validatePageWires(Array.from({length:501},()=>({})),
    wired.pages[0]!.shapes,wired.vectorSymbols??[]),/Invalid/);
});
test('deleting connected symbols is atomic and prunes wires; delete wire preserves symbols',()=>{
  const {project}=setup();
  const wired=connectPorts(project,{shapeId:'attached-a',portId:'top'},
    {shapeId:'attached-b',portId:'bottom'},'wire-1');
  assert.deepEqual(disconnectWire(wired,'wire-1').pages[0]!.wires,[]);
  const single=deleteShape(wired,'attached-a');
  assert.equal(single.pages[0]!.wires?.length,0);
  assert.doesNotThrow(()=>parseProject(single));
  const multi=deleteObjects(wired,['attached-b','heading']);
  assert.equal(multi.pages[0]!.wires?.length,0);
  assert.doesNotThrow(()=>parseProject(multi));
});
