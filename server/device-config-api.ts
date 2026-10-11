/**
 * CP-11 authenticated control plane, distinct from WebSocket telemetry.
 * Read-only Modbus acquisition configuration; never accepts PLC writes.
 */
import {timingSafeEqual,createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {validateModbusConfig,type ModbusConfig} from '../src/shared/modbus-mapping.ts';
import type {DeviceRuntime} from './device-runtime.ts';
import type {DeviceFleetRuntime} from './device-fleet-runtime.ts';
import type {AlarmEngine} from './alarm-engine.ts';
const MAX_BODY=48*1024;
const API_PREFIX='/api/device/';
export function createDeviceConfigHandler(runtime:DeviceRuntime,settings:{
 token:string;origins:readonly string[]
},fleet?:DeviceFleetRuntime,alarms?:AlarmEngine):(req:IncomingMessage,res:ServerResponse)=>boolean {
 if(settings.token.length<32||settings.token.length>1024)
  throw Error('HMI_ADMIN_TOKEN must contain 32–1024 characters');
 const secret=createHash('sha256').update(settings.token).digest();
 const origins=new Set(settings.origins);
 const respond=(res:ServerResponse,code:number,body:unknown)=>{
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',
   'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
   'Referrer-Policy':'no-referrer'});
  res.end(JSON.stringify(body));
 };
 const authorized=(req:IncomingMessage)=>{
  const header=req.headers.authorization;
  if(!header?.startsWith('Bearer '))return false;
  const digest=createHash('sha256').update(header.slice(7)).digest();
  return timingSafeEqual(secret,digest);
 };
 return (req,res)=>{
  const isFleet=req.url==='/api/fleet'||req.url==='/api/fleet/apply'||
   req.url==='/api/fleet/test';
  const isAlarm=req.url==='/api/alarms'||req.url==='/api/alarms/config'||
   req.url==='/api/alarms/ack';
  if(!req.url?.startsWith(API_PREFIX)&&!isFleet&&!isAlarm)return false;
  const origin=req.headers.origin;
  if(!origin||!origins.has(origin)){
   respond(res,403,{error:'Origin denied'});return true;
  }
  res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
  if(!authorized(req)){
   res.setHeader('WWW-Authenticate','Bearer realm="Device management"');
   respond(res,401,{error:'Administrator authorization required'});return true;
  }
  if(req.url==='/api/alarms'&&req.method==='GET'){
   if(!alarms){respond(res,404,{error:'Alarm engine unavailable'});return true;}
   respond(res,200,alarms.snapshot());return true;
  }
  if(req.url==='/api/fleet'&&req.method==='GET'){
   if(!fleet){respond(res,404,{error:'Multi-PLC support unavailable'});return true;}
   respond(res,200,fleet.snapshot());return true;
  }
  if(fleet?.isActive()&&req.url?.startsWith(API_PREFIX)){
   respond(res,409,{error:'Multiple PLCs active. Use Devices & Tags fleet manager'});
   return true;
  }
  if(req.url==='/api/device/status'&&req.method==='GET'){
   respond(res,200,runtime.snapshot());return true;
  }
  const testOnly=req.url==='/api/device/test'&&req.method==='POST';
  const fleetTest=req.url==='/api/fleet/test'&&req.method==='POST';
  const fleetApply=req.url==='/api/fleet/apply'&&req.method==='POST';
  const alarmConfig=req.url==='/api/alarms/config'&&req.method==='POST';
  const alarmAck=req.url==='/api/alarms/ack'&&req.method==='POST';
  if(!testOnly&&!fleetTest&&!fleetApply&&!alarmConfig&&!alarmAck&&
    (req.url!=='/api/device/apply'||req.method!=='POST')){
   respond(res,404,{error:'Unknown device command'});return true;
  }
  if(req.headers['content-type']?.split(';')[0]?.trim()!=='application/json'){
   respond(res,415,{error:'JSON required'});return true;
  }
  void (async()=>{
   let size=0,parts:Buffer[]=[];
   try{
    for await(const chunk of req){
     const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
     size+=bytes.length;
     if(size>(isFleet?512*1024:MAX_BODY))
      throw Error('Configuration request too large');
     parts.push(bytes);
    }
    const body=JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string,unknown>;
    if(!body||typeof body!=='object'||Array.isArray(body))
      throw Error('Invalid configuration envelope');
    if(alarmConfig||alarmAck){
      if(!alarms)throw Error('Alarm engine unavailable');
      const keys=Object.keys(body);
      if(alarmAck){
       if(keys.length!==1||keys[0]!=='id'||typeof body['id']!=='string')
        throw Error('Invalid acknowledgment request');
       respond(res,200,alarms.acknowledge(body['id']));
      }else{
       if(keys.some(k=>!['revision','rules'].includes(k))||
        !Number.isSafeInteger(body['revision']))
        throw Error('Invalid alarm configuration request');
       respond(res,200,alarms.configure({rules:body['rules']},body['revision'] as number));
      }
    }else if(fleetTest||fleetApply){
      if(!fleet)throw Error('Multi-PLC runtime unavailable');
      const names=Object.keys(body);
      if(fleetTest){
       if(names.some(key=>key!=='device'))throw Error('Invalid PLC test payload');
       const result=await fleet.testDevice(body['device']);
       respond(res,200,result);
      }else{
       if(names.some(key=>!['revision','devices'].includes(key))||
         !Number.isSafeInteger(body['revision']))
         throw Error('Invalid fleet revision or device list');
       const result=await fleet.apply({devices:body['devices']},body['revision'] as number);
       respond(res,200,{ok:true,...result});
      }
    }else{
      if(testOnly?Object.keys(body).some(key=>key!=='config'):
         Object.keys(body).some(key=>!['revision','config'].includes(key))||
         !Number.isSafeInteger(body['revision']))
       throw Error('Invalid configuration envelope');
      const config=validateModbusConfig(body['config'] as ModbusConfig);
      const result=testOnly?await runtime.testConnection(config):
        await runtime.apply(config,body['revision'] as number);
      respond(res,200,{ok:true,...result});
    }
   }catch(error){
    const msg=error instanceof Error?error.message:'Configuration failed';
    const conflict=/conflict|in progress/.test(msg);
    respond(res,conflict?409:400,{error:msg});
   }
  })();
  return true;
 };
}
