import {createTagHub} from './tag-hub.ts';
import {modbusFromEnvironment} from './adapter-config.ts';
import {DeviceRuntime} from './device-runtime.ts';
import {createDeviceConfigHandler} from './device-config-api.ts';
import {restoreActiveModbusConfig,persistActiveModbusConfig} from './active-device-config.ts';

const port=Number(process.env['HMI_PORT']??8787);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Bad HMI_PORT');
const token=process.env['HMI_ADMIN_TOKEN'];
const custom=process.env['HMI_ALLOWED_ORIGIN'];
const allowedOrigins=custom?[custom,'http://127.0.0.1:8787',
 'http://localhost:8787']:undefined;
// An explicit configured source takes priority over previous UI-applied state.
const initial=modbusFromEnvironment(process.env)??(token?restoreActiveModbusConfig():null);
const activeSource=initial?
 (process.env['HMI_SOURCE']==='modbus-lab'?'MODBUS_LAB':'MODBUS_TCP'):'DEMO';
const hub=createTagHub({
 demo:initial===null,source:activeSource,allowedOrigins
});
const runtime=new DeviceRuntime(hub,undefined,persistActiveModbusConfig);
if(token){
 hub.setControlHandler(createDeviceConfigHandler(runtime,{
  token,origins:allowedOrigins??[
   'http://127.0.0.1:4200','http://localhost:4200',
   'http://127.0.0.1:8787','http://localhost:8787'
  ]
 }));
}
hub.http.listen(port,'127.0.0.1',()=>{
 if(initial)runtime.startInitial(initial);
 console.log(JSON.stringify({status:'listening',url:'http://127.0.0.1:'+port,
  ws:'ws://127.0.0.1:'+port+'/ws/tags',
  source:activeSource,readOnly:true,adminEnabled:!!token}));
});
let shuttingDown=false;
for(const sig of ['SIGINT','SIGTERM'] as const)
 process.on(sig,()=>{
  if(shuttingDown)return;
  shuttingDown=true;
  void (async()=>{await runtime.stop();await hub.close();process.exit(0);})()
   .catch(error=>{console.error(error);process.exitCode=1;});
 });
