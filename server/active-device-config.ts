/** Atomic persistence of active Modbus config for restart continuity. */
import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {validateModbusConfig,type ModbusConfig} from '../src/shared/modbus-mapping.ts';
const ACTIVE_PATH=resolve(process.cwd(),'config','modbus-active.json');
export function restoreActiveModbusConfig():Required<ModbusConfig>|null {
 if(!existsSync(ACTIVE_PATH))return null;
 const text=readFileSync(ACTIVE_PATH,'utf8');
 if(text.length>48*1024)throw Error('Active Modbus file oversized');
 return validateModbusConfig(JSON.parse(text) as ModbusConfig);
}
export function persistActiveModbusConfig(config:Required<ModbusConfig>):void {
 const safe=validateModbusConfig(config);
 const temp=ACTIVE_PATH+'.tmp-'+randomBytes(8).toString('hex');
 try{
  writeFileSync(temp,JSON.stringify(safe,null,2)+'\n',{mode:0o600,flag:'wx'});
  renameSync(temp,ACTIVE_PATH);
 }catch(error){
  try{unlinkSync(temp);}catch{}
  throw error;
 }
}
