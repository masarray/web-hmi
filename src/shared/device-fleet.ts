/** CP-13 shared multi-PLC configuration; browser and Node use identical rules. */
import {validateModbusConfig,type ModbusConfig} from './modbus-mapping.ts';
import {VALID_TAG} from './tag-protocol.ts';
export const MAX_DEVICES=16;
export const DEVICE_ID=/^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
export interface FleetDevice {
 readonly id:string;
 readonly name:string;
 readonly config:ModbusConfig;
}
export interface FleetConfig {readonly devices:readonly FleetDevice[];}
export function qualifiedTag(id:string,tag:string):string {
 const combined=id+'/'+tag;
 if(!DEVICE_ID.test(id)||!VALID_TAG.test(combined))
  throw Error('Invalid qualified PLC tag identifier');
 return combined;
}
export function validateFleet(value:unknown):FleetConfig{
 if(!value||typeof value!=='object'||Array.isArray(value)||
   Object.keys(value).some(k=>k!=='devices'))throw Error('Invalid device list');
 const devices=(value as Record<string,unknown>).devices;
 if(!Array.isArray(devices)||devices.length>MAX_DEVICES)
  throw Error('Device limit exceeded (16 PLCs)');
 const ids=new Set<string>();
 const parsed: FleetDevice[]=[];
 for(const raw of devices){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).some(k=>!['id','name','config'].includes(k)))
   throw Error('Invalid PLC entry');
  const row=raw as Record<string,unknown>;
  const id=row.id,name=row.name;
  if(typeof id!=='string'||!DEVICE_ID.test(id)||ids.has(id)||
     typeof name!=='string'||name.trim()!==name||
     name.length<1||name.length>64||/[<>\r\n]/.test(name))
   throw Error('Invalid or duplicate PLC name/ID');
  const config=validateModbusConfig(row.config as ModbusConfig);
  for(const tag of config.tags)qualifiedTag(id,tag.tagId);
  ids.add(id);
  parsed.push({id,name,config});
 }
 return {devices:parsed};
}
