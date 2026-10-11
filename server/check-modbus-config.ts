/** Validate an explicit lab mapping before starting any network connection. */
import {readLabConfigFile,describeReadPlan} from './adapter-config.ts';
const filename=process.argv[2];
if(!filename){console.error('Usage: npm run check:modbus -- modbus-lab.example.json');process.exitCode=2;}
else {
 try{
  const cfg=readLabConfigFile(filename);
  console.log(JSON.stringify({
   status:'VALIDATED_ONLY',source:'MODBUS_LAB',readOnly:true,
   host:cfg.host,port:cfg.port,unitId:cfg.unitId,
   pollMs:cfg.pollMs,requestTimeoutMs:cfg.requestTimeoutMs,
   ...describeReadPlan(cfg)
  },null,2));
 }catch(error){
  console.error('Invalid mapping:',error instanceof Error?error.message:String(error));
  process.exitCode=1;
 }
}
