import {createTagHub} from './tag-hub.ts';
import {ModbusTcpReadAdapter} from './adapters/modbus-tcp.ts';
import {modbusFromEnvironment} from './adapter-config.ts';

const port=Number(process.env['HMI_PORT']??8787);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Bad HMI_PORT');
const custom=process.env['HMI_ALLOWED_ORIGIN'];
const adapterConfig=modbusFromEnvironment(process.env);
const hub=createTagHub({
 demo:adapterConfig===null,source:adapterConfig?'MODBUS_LAB':'DEMO',
 allowedOrigins:custom?[custom,'http://127.0.0.1:8787','http://localhost:8787']:undefined
});
const adapter=adapterConfig?new ModbusTcpReadAdapter(adapterConfig,
 sample=>{hub.publish(sample);},
 state=>console.log(JSON.stringify({source:'MODBUS_LAB',health:state}))
):null;
hub.http.listen(port,'127.0.0.1',()=>{
 adapter?.start();
 console.log(JSON.stringify({status:'listening',url:'http://127.0.0.1:'+port,
  ws:'ws://127.0.0.1:'+port+'/ws/tags',
  source:adapter?'MODBUS_LAB':'DEMO',readOnly:true}));
});
let shuttingDown=false;
for(const sig of ['SIGINT','SIGTERM'] as const)
 process.on(sig,()=>{
  if(shuttingDown)return;
  shuttingDown=true;
  void (async()=>{await adapter?.stop();await hub.close();process.exit(0);})()
   .catch(err=>{console.error(err);process.exitCode=1;});
 });
