import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeTag,expectedDataBytes,planReads,validateModbusConfig,
 type RegisterTag,type ReadGroup} from '../server/adapters/modbus-codec.ts';

const fc=(tagId:string,functionCode:1|2|3|4,address:number,
 dataType?:RegisterTag['dataType'],wordOrder?:RegisterTag['wordOrder']):RegisterTag=>
 ({tagId,functionCode,address,...(dataType?{dataType}:{}),
   ...(wordOrder?{wordOrder}:{})});
const cfg=(tags:readonly RegisterTag[])=>({
 host:'127.0.0.1',port:15020,unitId:1,tags,pollMs:1000
});
test('FC01/02 packed bits are decoded least-significant-bit first across bytes',()=>{
 const tags=[fc('Coil0',1,0),fc('Coil7',1,7),fc('Coil8',1,8),
   fc('Discrete9',2,9),fc('Discrete10',2,10)];
 const validated=validateModbusConfig(cfg(tags));
 assert.equal(validated.tags.length,5);
 const plan=planReads(tags);
 assert.deepEqual(plan.map(p=>[p.functionCode,p.start,p.count]),
   [[1,0,1],[1,7,2],[2,9,2]]);
 assert.equal(expectedDataBytes(plan[0]!),1);
 assert.equal(decodeTag(plan[0]!,Buffer.from([0b00000001]),tags[0]!),true);
 assert.equal(decodeTag(plan[1]!,Buffer.from([0b00000011]),tags[1]!),true);
 assert.equal(decodeTag(plan[1]!,Buffer.from([0b00000011]),tags[2]!),true);
 assert.equal(decodeTag(plan[2]!,Buffer.from([0b00000010]),tags[3]!),false);
 assert.equal(decodeTag(plan[2]!,Buffer.from([0b00000010]),tags[4]!),true);
});
test('INT16, UINT16, INT32, UINT32 and FLOAT32 respect signedness and word order',()=>{
 const tags=[fc('U16',3,0),fc('S16',3,1,'int16'),
   fc('S32',3,2,'int32'),fc('U32',3,4,'uint32'),
   fc('F32',4,0,'float32'),fc('F32Swap',4,2,'float32','CDAB')];
 validateModbusConfig(cfg(tags));
 const reads=planReads(tags);
 assert.deepEqual(reads.map(p=>[p.functionCode,p.start,p.count]),[[3,0,6],[4,0,4]]);
 const regs=Buffer.alloc(12);
 regs.writeUInt16BE(65535,0);
 regs.writeInt16BE(-123,2);
 regs.writeInt32BE(-123456789,4);
 regs.writeUInt32BE(4000000000,8);
 assert.equal(decodeTag(reads[0]!,regs,tags[0]!),65535);
 assert.equal(decodeTag(reads[0]!,regs,tags[1]!),-123);
 assert.equal(decodeTag(reads[0]!,regs,tags[2]!),-123456789);
 assert.equal(decodeTag(reads[0]!,regs,tags[3]!),4000000000);
 const floats=Buffer.alloc(8);
 floats.writeFloatBE(12.5,0);
 // CDAB: first register is low word, second register is high word.
 const other=Buffer.alloc(4);other.writeFloatBE(-3.25,0);
 floats.set(other.subarray(2,4),4);floats.set(other.subarray(0,2),6);
 const snapshot=Buffer.from(floats);
 assert.equal(decodeTag(reads[1]!,floats,tags[4]!),12.5);
 assert.equal(decodeTag(reads[1]!,floats,tags[5]!),-3.25);
 assert.deepEqual(floats,snapshot); // no in-place mutating shared receive frame
});
test('planner handles overlapping multiword values and max span',()=>{
 const tags=[fc('Float',3,0,'float32'),fc('Word1',3,1),
   fc('Word31',3,31),fc('Wide31',3,31,'int32'),
   fc('Bit127',1,127),fc('Bit128',1,128)];
 const plans=planReads(tags);
 assert.deepEqual(plans.map(p=>[p.functionCode,p.start,p.count]),[
  [1,127,2],[3,0,2],[3,31,2]
 ]);
 const mixed=[fc('A',3,0,'float32'),fc('B',3,1)];
 const p=planReads(mixed)[0]!;
 const data=Buffer.alloc(4);data.writeFloatBE(10,0);
 assert.equal(decodeTag(p,data,mixed[0]!),10);
 assert.equal(decodeTag(p,data,mixed[1]!),0);
 const spanning=Array.from({length:33},(_,i)=>fc('Tag'+i,3,i));
 assert.deepEqual(planReads(spanning).map(p=>p.count),[32,1]);
 const bits=Array.from({length:129},(_,i)=>fc('Coil'+i,1,i));
 assert.deepEqual(planReads(bits).map(p=>p.count),[128,1]);
});
test('validation rejects invalid function/type pair, overflow and mapping ambiguity',()=>{
 const bad=[
  fc('Coil',1,0,'uint16'),fc('RegBool',3,0,'bool'),
  fc('Signed',2,0,'int32'),fc('NearEnd',4,65535,'float32'),
  fc('Swap16',3,1,'int16','CDAB'),
  {...fc('Unknown',3,1),dataType:'arbitrary'},
  {...fc('WrongOrder',3,0,'float32'),wordOrder:'DCBA'},
  {...fc('Unexpected',3,0),expression:'process.exit(1)'},
  fc('Duplicate',3,1),fc('Duplicate',3,2)
 ];
 for(const item of bad.slice(0,-2))
  assert.throws(()=>validateModbusConfig(cfg([item as RegisterTag])));
 assert.throws(()=>validateModbusConfig(cfg(bad.slice(-2) as RegisterTag[])));
 assert.throws(()=>validateModbusConfig(cfg([fc('Overflow',1,65536)])));
 assert.throws(()=>validateModbusConfig(cfg([fc('BadName<script>',3,0)])));
});
test('FLOAT32 NaN/Infinity fails closed, incorrect byte payload is rejected',()=>{
 const t=fc('Analog',4,0,'float32'),group=planReads([t])[0]!;
 const nan=Buffer.alloc(4);nan.writeUInt32BE(0x7fc00000,0);
 assert.throws(()=>decodeTag(group,nan,t),/Non-finite/);
 const inf=Buffer.alloc(4);inf.writeUInt32BE(0x7f800000,0);
 assert.throws(()=>decodeTag(group,inf,t),/Non-finite/);
 assert.throws(()=>decodeTag(group,Buffer.alloc(2),t),/Invalid decode/);
});
