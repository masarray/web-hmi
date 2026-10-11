/**
 * CP-09 pure Modbus mapping planner and deterministic binary decoding.
 * FUXA reference: server/runtime/devices/modbus/datatypes.js (MIT).
 * This is an independent implementation with explicit type/word order.
 */
import {VALID_TAG} from '../../src/shared/tag-protocol.ts';
export type ReadFunction=1|2|3|4;
export type DataType='bool'|'uint16'|'int16'|'uint32'|'int32'|'float32';
export type WordOrder='ABCD'|'CDAB';
export interface RegisterTag {
 readonly tagId:string;
 readonly functionCode:ReadFunction;
 readonly address:number; // Zero-based Modbus PDU address, not 40001 notation.
 readonly dataType?:DataType; // FC01/02 default bool, FC03/04 default uint16
 readonly wordOrder?:WordOrder; // 32-bit only
}
export interface ModbusConfig {
 readonly host:string;
 readonly port:number;
 readonly unitId:number;
 readonly tags:readonly RegisterTag[];
 readonly pollMs?:number;
 readonly requestTimeoutMs?:number;
 readonly reconnectMaxMs?:number;
}
export interface ReadGroup {
 readonly functionCode:ReadFunction;
 readonly start:number;
 readonly count:number;
 readonly tags:readonly RegisterTag[];
}
const MAX_TAGS=128,MAX_REGS=32,MAX_BITS=128;
const types=new Set<DataType>(['bool','uint16','int16','uint32','int32','float32']);
export function dataTypeOf(tag:RegisterTag):DataType {
 return tag.dataType??(tag.functionCode<=2?'bool':'uint16');
}
export function widthOf(tag:RegisterTag):number {
 return tag.functionCode<=2?1:
  (['uint32','int32','float32'].includes(dataTypeOf(tag))?2:1);
}
export function validateModbusConfig(config:ModbusConfig):Required<ModbusConfig> {
 if(!config||typeof config!=='object'||Array.isArray(config)||
   Object.keys(config).some(key=>!['host','port','unitId','tags',
    'pollMs','requestTimeoutMs','reconnectMaxMs'].includes(key)))
  throw Error('Invalid Modbus config object or attribute');
 const pollMs=config.pollMs??1000;
 const requestTimeoutMs=config.requestTimeoutMs??800;
 const reconnectMaxMs=config.reconnectMaxMs??5000;
 if(!['127.0.0.1','::1','localhost'].includes(config.host))
  throw Error('Only loopback Modbus endpoints are allowed');
 if(!Number.isInteger(config.port)||config.port<1||config.port>65535||
    !Number.isInteger(config.unitId)||config.unitId<1||config.unitId>247||
    !Number.isInteger(pollMs)||pollMs<50||pollMs>60000||
    !Number.isInteger(requestTimeoutMs)||requestTimeoutMs<40||requestTimeoutMs>10000||
    !Number.isInteger(reconnectMaxMs)||reconnectMaxMs<100||reconnectMaxMs>30000)
  throw Error('Invalid Modbus connection limits');
 if(!Array.isArray(config.tags)||config.tags.length===0||config.tags.length>MAX_TAGS)
  throw Error('Invalid tag count');
 const seen=new Set<string>();
 for(const tag of config.tags){
  if(!tag||typeof tag!=='object'||typeof tag.tagId!=='string'||
     !VALID_TAG.test(tag.tagId)||seen.has(tag.tagId)||
     !([1,2,3,4] as number[]).includes(tag.functionCode)||
     !Number.isInteger(tag.address)||tag.address<0||tag.address>65535)
   throw Error('Invalid or duplicated Modbus register mapping');
  seen.add(tag.tagId);
  const type=dataTypeOf(tag);
  if(!types.has(type)||(tag.functionCode<=2?type!=='bool':type==='bool')||
     tag.address+widthOf(tag)>65536||
     (tag.wordOrder!==undefined&&
      (!['ABCD','CDAB'].includes(tag.wordOrder)||widthOf(tag)!==2)))
   throw Error('Invalid Modbus data type, word order or address span');
  // Unknown fields should not be accepted silently as future behaviors.
  if(Object.keys(tag).some(key=>!['tagId','functionCode','address','dataType','wordOrder'].includes(key)))
   throw Error('Unsupported tag mapping attribute');
 }
 return {...config,pollMs,requestTimeoutMs,reconnectMaxMs};
}
/** Plan minimal contiguous ranges, bounded by FC-specific frame size. */
export function planReads(tags:readonly RegisterTag[]):readonly ReadGroup[] {
 const ordered=[...tags].sort((a,b)=>a.functionCode-b.functionCode||a.address-b.address);
 const result:ReadGroup[]=[];
 let entries:RegisterTag[]=[],start=0,end=0,fn:ReadFunction=3;
 const flush=()=>{
  if(entries.length)result.push({functionCode:fn,start,count:end-start,tags:entries});
  entries=[];
 };
 for(const tag of ordered){
  const nextEnd=tag.address+widthOf(tag),limit=tag.functionCode<=2?MAX_BITS:MAX_REGS;
  if(!entries.length){start=tag.address;end=nextEnd;fn=tag.functionCode;}
  else if(tag.functionCode!==fn||tag.address>end||Math.max(end,nextEnd)-start>limit){
   flush();start=tag.address;end=nextEnd;fn=tag.functionCode;
  }else end=Math.max(end,nextEnd);
  entries.push(tag);
 }
 flush();
 return result;
}
export function expectedDataBytes(group:ReadGroup):number {
 return group.functionCode<=2?Math.ceil(group.count/8):group.count*2;
}
export function decodeTag(group:ReadGroup,bytes:Buffer,tag:RegisterTag):boolean|number {
 const index=tag.address-group.start,type=dataTypeOf(tag);
 if(index<0||index+widthOf(tag)>group.count||
   bytes.length!==expectedDataBytes(group))throw Error('Invalid decode range');
 if(group.functionCode<=2){
  return (bytes[index>>3]!&(1<<(index&7)))!==0; // FC01/02 LSB-first
 }
 const offset=index*2;
 if(type==='uint16')return bytes.readUInt16BE(offset);
 if(type==='int16')return bytes.readInt16BE(offset);
 if(type==='bool')throw Error('Boolean register type not supported');
 const four=bytes.subarray(offset,offset+4);
 if(four.length!==4)throw Error('Truncated 32-bit value');
 // Never mutate the original shared Modbus receive frame.
 const word=tag.wordOrder==='CDAB'
  ?Buffer.from([four[2]!,four[3]!,four[0]!,four[1]!]):four;
 const value=type==='uint32'?word.readUInt32BE(0):
   type==='int32'?word.readInt32BE(0):word.readFloatBE(0);
 if(!Number.isFinite(value))throw Error('Non-finite Modbus register value');
 return value;
}
