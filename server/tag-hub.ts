import {createServer,type Server} from 'node:http';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {parseSubscription,validSample,TAG_STALE_AFTER_MS,type WireSample,type ServerMessage} from '../src/shared/tag-protocol.ts';
const MAX_CLIENTS=64,MAX_BUFFERED=131072;
const DEMO=['Plant/Motor','Plant/Gear','Plant/P1','Pump/Motor','Pump/Pressure'] as const;
export interface TagHub {
 readonly http:Server;
 publish:(sample:WireSample)=>boolean;
 metrics:()=>{clients:number;subscriptions:number;sourceTicks:number;droppedClients:number};
 resetSource:(source:'DEMO'|'MODBUS_LAB'|'MODBUS_TCP')=>void;
 stopDemo:()=>void;
 setControlHandler:(handler:(req:IncomingMessage,res:ServerResponse)=>boolean)=>void;
 setAlarmObserver:(observer:(sample:WireSample)=>void,onReset:()=>void)=>void;
 close:()=>Promise<void>;
}
/** One source and one acquisition stream fan out across all browser subscribers. */
export function createTagHub(opts:{
 allowedOrigins?:readonly string[];heartbeatMs?:number;sourceIntervalMs?:number;demo?:boolean;staleMs?:number;source?:'DEMO'|'MODBUS_LAB'|'MODBUS_TCP';
}={}):TagHub {
 const heartbeatMs=opts.heartbeatMs??1000;
 if(!Number.isInteger(heartbeatMs)||heartbeatMs<100)throw Error('Bad heartbeat');
 const staleMs=opts.staleMs??TAG_STALE_AFTER_MS;
 if(!Number.isInteger(staleMs)||staleMs<25||staleMs>60000)throw Error('Bad stale interval');
 const origins=new Set(opts.allowedOrigins??[
  'http://127.0.0.1:4200','http://localhost:4200',
  'http://127.0.0.1:8787','http://localhost:8787']);
 const clients=new Map<WebSocket,Set<string>>();
 const index=new Map<string,Set<WebSocket>>();
 const samples=new Map<string,WireSample>();
 const sampleTimes=new Map<string,number>();
 const MAX_SOURCE_TAGS=8192;
 const pong=new WeakMap<WebSocket,number>();
 let sourceTicks=0,droppedClients=0,closed=false;
 let sourceKind=opts.source??'DEMO';
 let controlHandler:((req:IncomingMessage,res:ServerResponse)=>boolean)|null=null;
 let alarmObserver:((sample:WireSample)=>void)|null=null;
 let alarmReset:(()=>void)|null=null;
 const http=createServer((req,res)=>{
  if(controlHandler?.(req,res))return;
  if(req.method==='GET'&&req.url==='/health'){
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   res.end(JSON.stringify({status:'ok',source:sourceKind,protocol:1,readOnly:true}));
  }else{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
 });
 function resetSource(source:'DEMO'|'MODBUS_LAB'|'MODBUS_TCP'):void{
  sourceKind=source;
  samples.clear();sampleTimes.clear();
  alarmReset?.();
  for(const ws of clients.keys())emit(ws,{type:'source-reset',source});
 }
 const wss=new WebSocketServer({noServer:true,maxPayload:32768,perMessageDeflate:false});
 const emit=(ws:WebSocket,msg:ServerMessage)=>{
  if(ws.readyState!==WebSocket.OPEN)return;
  if(ws.bufferedAmount>MAX_BUFFERED){droppedClients++;ws.terminate();return;}
  ws.send(JSON.stringify(msg),{compress:false});
 };
 function release(ws:WebSocket){
  const old=clients.get(ws);
  if(!old)return;
  for(const id of old){const set=index.get(id);set?.delete(ws);if(set?.size===0)index.delete(id);}
  clients.delete(ws);
 }
 function publish(sample:WireSample):boolean{
  if(closed||!validSample(sample))throw Error('Invalid sample or closed server');
  const prior=samples.get(sample.tagId);
  if(prior&&prior.sequence>=sample.sequence)return false;
  if(!prior&&samples.size>=MAX_SOURCE_TAGS)throw Error('Source tag quota exceeded');
  samples.set(sample.tagId,{...sample});
  sampleTimes.set(sample.tagId,Date.now());
  alarmObserver?.(sample);
  for(const ws of index.get(sample.tagId)??[])emit(ws,{type:'sample',sample});
  return true;
 }
 http.on('upgrade',(req,socket,head)=>{
  if(req.url!=='/ws/tags'||!req.headers.origin||
     !origins.has(req.headers.origin)||clients.size>=MAX_CLIENTS){
   socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
   socket.destroy();return;
  }
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
 });
 wss.on('connection',ws=>{
  clients.set(ws,new Set());pong.set(ws,Date.now());
  ws.on('pong',()=>pong.set(ws,Date.now()));
  emit(ws,{type:'hello',version:1,source:sourceKind,heartbeatMs});
  ws.on('message',buf=>{
   let tags:string[];
   try{tags=parseSubscription(JSON.parse(buf.toString())).tags;}
   catch{ws.close(1008,'Subscription rejected');return;}
   const previous=clients.get(ws);
   if(!previous)return;
   for(const id of previous){const set=index.get(id);set?.delete(ws);
    if(set?.size===0)index.delete(id);}
   clients.set(ws,new Set(tags));
   for(const id of tags){let set=index.get(id);
    if(!set){set=new Set();index.set(id,set);}set.add(ws);}
   emit(ws,{type:'subscribed',tags});
   for(const id of tags){
    const cached=samples.get(id);
    const age=Date.now()-(sampleTimes.get(id)??0);
    const sample:WireSample=!cached?{tagId:id,value:null,quality:'STALE',sequence:0}:
      age>=staleMs?{...cached,value:null,quality:'STALE'}:cached;
    emit(ws,{type:'sample',sample});
   }
  });
  ws.on('close',()=>release(ws));
  ws.on('error',()=>release(ws));
 });
 const heartbeat=setInterval(()=>{
  const now=Date.now();
  for(const ws of clients.keys()){
   if(now-(pong.get(ws)??0)>heartbeatMs*4){droppedClients++;ws.terminate();continue;}
   ws.ping();emit(ws,{type:'heartbeat',serverTime:now});
  }
 },heartbeatMs);
 heartbeat.unref();
 let sourceTimer:ReturnType<typeof setInterval>|undefined;
 if(opts.demo!==false){
  let tick=0;
  sourceTimer=setInterval(()=>{
   tick++;sourceTicks++;
   for(const id of DEMO)publish({tagId:id,
    value:id==='Pump/Pressure'?52+tick%9:tick%4<2?1:0,
    quality:'GOOD',sequence:tick});
  },opts.sourceIntervalMs??1000);
  sourceTimer.unref();
 }
 return {http,publish,resetSource,stopDemo:()=>{if(sourceTimer)clearInterval(sourceTimer);
  sourceTimer=undefined;},
 setControlHandler:handler=>{controlHandler=handler;},
 setAlarmObserver:(observer,onReset)=>{alarmObserver=observer;alarmReset=onReset;},metrics:()=>({
  clients:clients.size,subscriptions:[...index.values()].reduce((n,set)=>n+set.size,0),
  sourceTicks,droppedClients
 }),close:async()=>{
  if(closed)return;closed=true;
  clearInterval(heartbeat);if(sourceTimer)clearInterval(sourceTimer);
  for(const ws of clients.keys())ws.terminate();
  await new Promise<void>((resolve,reject)=>wss.close(error=>{
   if(error)return reject(error);
   if(!http.listening)return resolve();
   http.close(e=>e?reject(e):resolve());
  }));
 }};
}
