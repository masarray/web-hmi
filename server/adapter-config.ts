/** CP-08 is strictly opt-in: read-only loopback laboratory Modbus TCP. */
import {validateModbusConfig,type ModbusConfig,type RegisterTag} from './adapters/modbus-tcp.ts';

export function modbusFromEnvironment(env:NodeJS.ProcessEnv):Required<ModbusConfig>|null{
 if(env['HMI_SOURCE']===undefined || env['HMI_SOURCE']==='demo')return null;
 if(env['HMI_SOURCE']!=='modbus-lab')throw Error('Unsupported HMI_SOURCE');
 const raw=env['HMI_MODBUS_TAGS'];
 if(!raw || raw.length>8192)throw Error('Missing or oversized HMI_MODBUS_TAGS');
 let tags:unknown;
 try{tags=JSON.parse(raw);}catch{throw Error('Invalid HMI_MODBUS_TAGS JSON');}
 if(!Array.isArray(tags))throw Error('Modbus mappings must be array');
 const port=Number(env['HMI_MODBUS_PORT']);
 const unitId=Number(env['HMI_MODBUS_UNIT']??1);
 const config:ModbusConfig={
  host:env['HMI_MODBUS_HOST']??'127.0.0.1',
  port,unitId,tags:tags as RegisterTag[],
  pollMs:Number(env['HMI_MODBUS_POLL_MS']??1000),
  requestTimeoutMs:Number(env['HMI_MODBUS_TIMEOUT_MS']??800)
 };
 return validateModbusConfig(config);
}
