import {createTagHub} from './tag-hub.ts';
import {modbusFromEnvironment} from './adapter-config.ts';
import {DeviceRuntime} from './device-runtime.ts';
import {DeviceFleetRuntime} from './device-fleet-runtime.ts';
import {createDeviceConfigHandler} from './device-config-api.ts';
import {restoreActiveModbusConfig,persistActiveModbusConfig} from './active-device-config.ts';
import {restoreFleet,saveFleet} from './active-fleet-config.ts';
import {AlarmEngine} from './alarm-engine.ts';
import {loadAlarmFiles,makeAlarmFileStore} from './alarm-persistence.ts';
import {TrendHistorian} from './trend-historian.ts';
import {createTrendFileStore} from './trend-storage.ts';

const port=Number(process.env['HMI_PORT']??8787);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Bad HMI_PORT');
const token=process.env['HMI_ADMIN_TOKEN'];
const custom=process.env['HMI_ALLOWED_ORIGIN'];
const allowedOrigins=custom?[custom,'http://127.0.0.1:8787',
 'http://localhost:8787']:undefined;
// Explicit single-device environment config takes precedence over saved sources.
const explicit=modbusFromEnvironment(process.env);
const storedFleet=token&&!explicit?restoreFleet():null;
const initial=explicit??(storedFleet?null:token?restoreActiveModbusConfig():null);
const activeSource=storedFleet?'MODBUS_TCP':initial?
 (process.env['HMI_SOURCE']==='modbus-lab'?'MODBUS_LAB':'MODBUS_TCP'):'DEMO';
const hub=createTagHub({demo:!initial&&!storedFleet,source:activeSource,allowedOrigins});
const alarms=new AlarmEngine(makeAlarmFileStore(),Date.now,loadAlarmFiles());
const trendFiles=createTrendFileStore();
const trends=new TrendHistorian(trendFiles.store,Date.now,trendFiles.restore());
hub.setAlarmObserver(sample=>alarms.observe(sample),()=>alarms.sourceReset());
hub.setTrendObserver(sample=>trends.observe(sample),()=>trends.sourceReset());
const runtime=new DeviceRuntime(hub,undefined,persistActiveModbusConfig);
const fleet=new DeviceFleetRuntime(hub,undefined,saveFleet,async()=>runtime.stop());
if(token){
 hub.setControlHandler(createDeviceConfigHandler(runtime,{
  token,origins:allowedOrigins??[
   'http://127.0.0.1:4200','http://localhost:4200',
   'http://127.0.0.1:8787','http://localhost:8787'
  ]
 },fleet,alarms,trends));
}
hub.http.listen(port,'127.0.0.1',()=>{
 if(initial)runtime.startInitial(initial);
 if(storedFleet)fleet.restore(storedFleet.config,storedFleet.revision);
 console.log(JSON.stringify({status:'listening',url:'http://127.0.0.1:'+port,
  ws:'ws://127.0.0.1:'+port+'/ws/tags',
  source:activeSource,readOnly:true,adminEnabled:!!token,
  multiDevice:!!storedFleet}));
});
let shuttingDown=false;
for(const sig of ['SIGINT','SIGTERM'] as const)
 process.on(sig,()=>{
  if(shuttingDown)return;
  shuttingDown=true;
  void (async()=>{await fleet.stop();await runtime.stop();trends.close();await hub.close();process.exit(0);})()
   .catch(error=>{console.error(error);process.exitCode=1;});
 });
