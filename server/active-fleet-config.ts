/** Persistent PLC fleet config; single atomic replacement, no credentials stored. */
import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {validateFleet,type FleetConfig} from '../src/shared/device-fleet.ts';
const PATH=resolve(process.cwd(),'config','modbus-fleet.json');
export function restoreFleet():{revision:number;config:FleetConfig}|null{
 if(!existsSync(PATH))return null;
 const data=readFileSync(PATH,'utf8');
 if(data.length>512*1024)throw Error('PLC fleet config too large');
 const obj=JSON.parse(data) as Record<string,unknown>;
 if(!obj||!Number.isSafeInteger(obj['revision'])||
   (obj['revision'] as number)<0||
   Object.keys(obj).some(k=>!['revision','devices'].includes(k)))
  throw Error('Invalid PLC fleet file');
 return {revision:obj['revision'] as number,
  config:validateFleet({devices:obj['devices']})};
}
export function saveFleet(config:FleetConfig,revision:number):void{
 const safe=validateFleet(config);
 if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid revision');
 const temporary=PATH+'.tmp-'+randomBytes(8).toString('hex');
 try{
  writeFileSync(temporary,JSON.stringify({revision,devices:safe.devices},null,2)+'\n',
   {mode:0o600,flag:'wx'});
  renameSync(temporary,PATH);
 }catch(error){
  try{unlinkSync(temporary);}catch{}
  throw error;
 }
}
