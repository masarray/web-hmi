/* CP-10: explicit read-only industrial Modbus endpoint from server configuration. */
import {readFileSync,lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {validateModbusConfig,planReads,
 type ModbusConfig,type RegisterTag} from './adapters/modbus-codec.ts';

const FILE_LIMIT=16384;
const CONFIG_DIR=resolve(process.cwd(),'config');
/** Only a basename in ./config; no absolute paths or traversal accepted. */
export function readLabConfigFile(name:string):Required<ModbusConfig> {
 if(!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,100}\.json$/.test(name)||
   name.includes('..'))throw Error('Invalid Modbus config filename');
 const path=resolve(CONFIG_DIR,name);
 const stat=lstatSync(path);
 if(stat.isSymbolicLink()||!stat.isFile()||stat.size>FILE_LIMIT)throw Error('Modbus config file too large');
 const raw=readFileSync(path,'utf8');
 let obj:unknown;
 try{obj=JSON.parse(raw);}catch{throw Error('Invalid Modbus config JSON');}
 if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('Invalid Modbus config object');
 return validateModbusConfig(obj as ModbusConfig);
}
export function modbusFromEnvironment(env:NodeJS.ProcessEnv):Required<ModbusConfig>|null {
 if(env['HMI_SOURCE']===undefined||env['HMI_SOURCE']==='demo')return null;
 if(env['HMI_SOURCE']!=='modbus-lab'&&env['HMI_SOURCE']!=='modbus-tcp')throw Error('Unsupported HMI_SOURCE');
 const file=env['HMI_MODBUS_CONFIG_FILE'];
 if(file!==undefined){
  if(env['HMI_MODBUS_TAGS'])throw Error('Specify config file or inline mappings, not both');
  return readLabConfigFile(file);
 }
 const raw=env['HMI_MODBUS_TAGS'];
 if(!raw||raw.length>8192)throw Error('Missing or oversized HMI_MODBUS_TAGS');
 let tags:unknown;
 try{tags=JSON.parse(raw);}catch{throw Error('Invalid HMI_MODBUS_TAGS JSON');}
 if(!Array.isArray(tags))throw Error('Modbus mappings must be array');
 return validateModbusConfig({
  host:env['HMI_MODBUS_HOST']??'127.0.0.1',
  port:Number(env['HMI_MODBUS_PORT']),
  unitId:Number(env['HMI_MODBUS_UNIT']??1),
  tags:tags as RegisterTag[],
  pollMs:Number(env['HMI_MODBUS_POLL_MS']??1000),
  requestTimeoutMs:Number(env['HMI_MODBUS_TIMEOUT_MS']??800)
 });
}
/** Deterministic preflight summary to show users the actual requests before connecting. */
export function describeReadPlan(config:ModbusConfig):{
 tags:number;requests:number;groups:ReadonlyArray<{
  functionCode:number;start:number;count:number;tags:readonly string[]
 }>;} {
 const safe=validateModbusConfig(config);
 const groups=planReads(safe.tags).map(g=>({
  functionCode:g.functionCode,start:g.start,count:g.count,
  tags:g.tags.map(t=>t.tagId)
 }));
 return {tags:safe.tags.length,requests:groups.length,groups};
}
