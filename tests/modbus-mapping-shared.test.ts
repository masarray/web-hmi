import test from 'node:test';
import assert from 'node:assert/strict';
import {dataTypeOf,widthOf,planReads,validateModbusConfig,validHost,
  type ModbusConfig} from '../src/shared/modbus-mapping.ts';
import {modbusFromEnvironment} from '../server/adapter-config.ts';
import {parseSubscription} from '../src/shared/tag-protocol.ts';

const sample:ModbusConfig={
 host:'192.168.10.25',port:502,unitId:1,pollMs:1000,requestTimeoutMs:800,
 tags:[
  {tagId:'Motor/Run',functionCode:1,address:0,dataType:'bool'},
  {tagId:'Motor/Trip',functionCode:2,address:5,dataType:'bool'},
  {tagId:'Motor/Current',functionCode:4,address:10,dataType:'float32',wordOrder:'CDAB'}
 ]
};
test('explicit industrial IPs and DNS names are valid; URL/path/injection denied',()=>{
 for(const host of ['192.168.1.10','10.3.4.5','172.16.10.1','plc1.factory.local',
   'device-2','127.0.0.1','::1'])
  assert.equal(validHost(host),true,host);
 for(const host of ['http://192.168.1.10','192.168.1.999','192.168.1.01',
  'plc/evil',' space','plc.local:502','host.local/path','','-host','a'.repeat(254)])
  assert.equal(validHost(host),false,host);
 const safe=validateModbusConfig(sample);
 assert.equal(safe.host,'192.168.10.25');
 assert.equal(safe.tags.length,3);
 assert.equal(safe.pollMs,1000);
});
test('browser-shared planner matches Node backend read grouping without duplication',async()=>{
 const shared=planReads(sample.tags);
 const node=await import('../server/adapters/modbus-codec.ts');
 assert.deepEqual(shared,node.planReads(sample.tags));
 assert.deepEqual(shared.map(g=>[g.functionCode,g.start,g.count]),[
   [1,0,1],[2,5,1],[4,10,2]
 ]);
 assert.equal(dataTypeOf(sample.tags[0]!), 'bool');
 assert.equal(widthOf(sample.tags[2]!),2);
});
test('server explicit modbus-tcp reads remote configuration without connecting',()=>{
 const parsed=modbusFromEnvironment({
  HMI_SOURCE:'modbus-tcp',HMI_MODBUS_HOST:'10.88.99.10',
  HMI_MODBUS_PORT:'502',HMI_MODBUS_UNIT:'4',
  HMI_MODBUS_TAGS:JSON.stringify(sample.tags)
 });
 assert.equal(parsed?.host,'10.88.99.10');
 assert.equal(parsed?.unitId,4);
 assert.equal(parsed?.tags.length,3);
 assert.throws(()=>modbusFromEnvironment({
  HMI_SOURCE:'modbus-tcp',HMI_MODBUS_HOST:'https://plc.local',
  HMI_MODBUS_PORT:'502',HMI_MODBUS_TAGS:JSON.stringify(sample.tags)
 }));
 assert.deepEqual(parseSubscription({type:'subscribe',version:1,
   tags:['Motor/Run','Motor/Current']}).tags,['Motor/Run','Motor/Current']);
});
test('strict configuration rejects invalid type/FCode, duplicate tags, oversized map',()=>{
 for(const tags of [
  [{tagId:'X',functionCode:1,address:5,dataType:'float32'}],
  [{tagId:'Y',functionCode:3,address:65535,dataType:'uint32'}],
  [{tagId:'Z',functionCode:3,address:10,expression:'alert(1)'}],
  [{tagId:'X',functionCode:3,address:0},{tagId:'X',functionCode:4,address:1}],
  Array.from({length:129},(_,i)=>({tagId:'Tag_'+i,functionCode:3,address:i}))
 ]){
  assert.throws(()=>validateModbusConfig({...sample,tags:tags as ModbusConfig['tags']}));
 }
});
