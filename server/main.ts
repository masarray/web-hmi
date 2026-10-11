import {createTagHub} from './tag-hub.ts';
const port=Number(process.env['HMI_PORT']??8787);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Bad HMI_PORT');
const custom=process.env['HMI_ALLOWED_ORIGIN'];
const hub=createTagHub({allowedOrigins:custom
 ?[custom,'http://127.0.0.1:8787','http://localhost:8787']:undefined});
hub.http.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({
 status:'listening',url:'http://127.0.0.1:'+port,
 ws:'ws://127.0.0.1:'+port+'/ws/tags',source:'DEMO',readOnly:true})));
for(const sig of ['SIGINT','SIGTERM'] as const)
 process.on(sig,()=>{void hub.close().then(()=>process.exit(0));});
