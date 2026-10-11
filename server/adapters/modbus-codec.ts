/** Node binary decoder; planner/validation share the exact browser-safe CP-10 contract. */
import {dataTypeOf,widthOf} from '../../src/shared/modbus-mapping.ts';
export {validateModbusConfig,planReads,expectedDataBytes,validHost} from '../../src/shared/modbus-mapping.ts';
export type {ReadFunction,DataType,WordOrder,RegisterTag,ModbusConfig,ReadGroup} from '../../src/shared/modbus-mapping.ts';
import type {ReadGroup,RegisterTag} from '../../src/shared/modbus-mapping.ts';
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
