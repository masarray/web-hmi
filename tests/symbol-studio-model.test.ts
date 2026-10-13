import test from 'node:test';
import assert from 'node:assert/strict';
import {CB_ROTATING} from '../src/app/editor/dynamic-symbol.ts';
import {migrateDynamicSymbolV1,parseVectorSymbol,parseVectorSymbolJson,
  importSymbolDefinition,resolveVectorFrame,indexVectorNodes,
  type VectorSymbol,type VectorTransform,type VectorStyle} from '../src/app/editor/symbol-studio-model.ts';

const t:VectorTransform={x:0,y:0,rotation:0,scaleX:1,scaleY:1,pivot:[0,0]};
const paint:VectorStyle={fill:'none',stroke:'#8899aa',strokeWidth:2,opacity:1};
const make=():VectorSymbol=>parseVectorSymbol({
  format:'web-hmi-vector-symbol',version:2,id:'user-switch',name:'Switchgear Original',
  viewBox:[120,140],ports:{top:[60,0],bottom:[60,140]},
  initialStateId:'OPEN',badStateId:'BAD_STATE',
  profiles:{singlePoint:['OPEN','CLOSED'],
    doublePoint:['INTERMEDIATE','OPEN','CLOSED','BAD_STATE']},
  nodes:[{
    kind:'group',id:'assembly',name:'CB housing',visible:true,transform:t,
    children:[
      {kind:'line',id:'blade',name:'moving blade',visible:true,transform:{...t,pivot:[60,35]},
        style:paint,x1:60,y1:35,x2:60,y2:89},
      {kind:'rect',id:'panel',name:'status square',visible:true,transform:t,style:paint,
        x:90,y:20,width:20,height:20},
      {kind:'ellipse',id:'lamp',name:'Status',visible:true,transform:t,style:paint,
        cx:100,cy:30,rx:5,ry:7},
      {kind:'text',id:'caption',name:'caption',visible:true,transform:t,style:paint,
        x:10,y:120,text:'CB TEST'}
    ]
  },{kind:'path',id:'terminal',name:'terminal shape',visible:true,transform:t,
    style:paint,d:'M 60 0 L 60 35'}],
  states:[
    {id:'OPEN',label:'Open',overrides:{blade:{
      style:{stroke:'#ffaa33'},transform:{rotation:-60}
    },panel:{style:{fill:'#ffdd88'}}}},
    {id:'CLOSED',label:'Closed',overrides:{
      blade:{style:{stroke:'#44bb77'},transform:{rotation:0}},
      panel:{style:{fill:'#224499'}},
      caption:{text:'CB CLOSED'},lamp:{visible:false}
    }},
    {id:'INTERMEDIATE',label:'In transit',overrides:{blade:{transform:{rotation:-30}}}},
    {id:'BAD_STATE',label:'Bad',overrides:{caption:{text:'INVALID'},blade:{style:{stroke:'#ff3355'}}}}
  ]
});

const sample=(value:number|null,quality:'GOOD'|'BAD'|'UNCERTAIN'='GOOD')=>({
  tagId:'G/XCBR1.Pos.stVal',value,quality,sequence:1,receivedAtMs:500
});
test('V2 canonical scene graph preserves nested group, all primitive geometries and ports',()=>{
  const def=make();
  const nodes=indexVectorNodes(def);
  assert.equal(nodes.size,6);
  assert.equal(nodes.get('blade')?.kind,'line');
  assert.equal(nodes.get('terminal')?.kind,'path');
  assert.deepEqual(def.ports.bottom,[60,140]);
  assert.deepEqual(parseVectorSymbol(JSON.parse(JSON.stringify(def))),def);
  assert.deepEqual(parseVectorSymbolJson(JSON.stringify(def)),def);
});

test('per-state per-element overrides inherit independent base properties',()=>{
  const def=make();
  const open=resolveVectorFrame(def,'double-point',sample(1),700,true,true);
  const closed=resolveVectorFrame(def,'double-point',sample(2),700,true,true);
  assert.equal(open.stateId,'OPEN');
  assert.equal(open.nodes.get('blade')?.transform.rotation,-60);
  assert.equal(open.nodes.get('blade')?.style?.stroke,'#ffaa33');
  assert.equal(open.nodes.get('blade')?.style?.strokeWidth,2);
  assert.equal(closed.nodes.get('blade')?.transform.rotation,0);
  assert.equal(closed.nodes.get('blade')?.transform.pivot[1],35);
  assert.equal(closed.nodes.get('lamp')?.visible,false);
  assert.equal(open.nodes.get('lamp')?.visible,true);
  assert.equal(closed.nodes.get('caption')?.text,'CB CLOSED');
  assert.equal(closed.nodes.get('panel')?.style?.fill,'#224499');
  assert.equal(indexVectorNodes(def).get('blade')?.kind,'line');
  assert.equal((indexVectorNodes(def).get('blade') as {style:VectorStyle}).style.stroke,'#8899aa');
});

test('Dbpos mapping is not reduced to nonzero and quality always overrides it',()=>{
  const def=make();
  const codes=['INTERMEDIATE','OPEN','CLOSED','BAD_STATE'];
  for(let i=0;i<4;i++){
    assert.equal(resolveVectorFrame(def,'double-point',sample(i),700,true,true).stateId,codes[i]);
  }
  assert.equal(resolveVectorFrame(def,'single-point',sample(0),700,true,true).stateId,'OPEN');
  assert.equal(resolveVectorFrame(def,'single-point',sample(1),700,true,true).stateId,'CLOSED');
  assert.equal(resolveVectorFrame(def,'single-point',sample(3),700,true,true).stateId,'BAD_STATE');
  const bad=resolveVectorFrame(def,'double-point',sample(2,'BAD'),700,true,true);
  assert.equal(bad.stateId,'BAD_STATE');
  assert.equal(bad.status,'BAD');
  assert.equal(bad.warning,true);
  assert.equal(resolveVectorFrame(def,'double-point',sample(2,'UNCERTAIN'),700,true,true).stateId,'BAD_STATE');
  assert.equal(resolveVectorFrame(def,'double-point',sample(2),9000,true,true).quality,'STALE');
  assert.equal(resolveVectorFrame(def,'double-point',undefined,700,true,true).stateId,'BAD_STATE');
  assert.equal(resolveVectorFrame(def,'double-point',undefined,700,false,true).quality,'UNBOUND');
});
test('V1 CB migrates to v2 preserving geometry, blade pivot, SP and Dbpos mapping',()=>{
  const def=migrateDynamicSymbolV1(CB_ROTATING);
  assert.equal(def.version,2);
  assert.equal(def.nodes.length,3);
  assert.equal(def.ports.bottom[1],96);
  assert.deepEqual(def.profiles.doublePoint,
    ['INTERMEDIATE','OPEN','CLOSED','BAD_STATE']);
  assert.equal(resolveVectorFrame(def,'double-point',sample(1),700,true,true)
    .nodes.get('blade')?.transform.rotation,-60);
  assert.equal(resolveVectorFrame(def,'double-point',sample(2),700,true,true)
    .nodes.get('blade')?.transform.rotation,0);
  assert.equal(importSymbolDefinition(CB_ROTATING).format,'web-hmi-vector-symbol');
});
test('reject hostile XML/JS, invalid nested tree and unknown state overrides',()=>{
  const def=make();
  assert.throws(()=>parseVectorSymbol({...def,nodes:[{
    kind:'path',id:'bad',name:'Bad path',visible:true,transform:t,style:paint,
    d:'M0 0 <script>alert(1)</script>'
  }]}));
  assert.throws(()=>parseVectorSymbol({...def,nodes:[
    {kind:'line',id:'same',name:'a',visible:true,transform:t,style:paint,
      x1:0,y1:0,x2:0,y2:20},
    {kind:'line',id:'same',name:'b',visible:true,transform:t,style:paint,
      x1:0,y1:0,x2:10,y2:20}
  ]}));
  const duplicateState={...def,states:[...def.states,def.states[0]]};
  assert.throws(()=>parseVectorSymbol(duplicateState));
  const missingNode={...def,states:def.states.map((s,i)=>
    i===0?{...s,overrides:{missing:{visible:false}}}:s)};
  assert.throws(()=>parseVectorSymbol(missingNode));
  const badTransform={...def,nodes:[{...def.nodes[0],transform:{...t,rotation:Infinity}}]};
  assert.throws(()=>parseVectorSymbol(badTransform));
  assert.throws(()=>parseVectorSymbolJson(' '.repeat(131073)));
  const invalidStyle={...def,states:def.states.map((s,i)=>
    i===0?{...s,overrides:{blade:{style:{fill:'url(https://evil.example/hmi)'}}}}:s)};
  assert.throws(()=>parseVectorSymbol(invalidStyle));
});
