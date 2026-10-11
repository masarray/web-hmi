import {MAX_TAGS,VALID_TAG,validSample,type WireSample,
  type ServerMessage} from '../../shared/tag-protocol.ts';
export type StreamStatus='disconnected'|'connecting'|'connected'|'reconnecting';
export interface TagStreamHooks {
 onStatus:(status:StreamStatus)=>void;
 onReset:()=>void;
 onSample:(sample:WireSample,receivedAtMs:number)=>void;
}
const BACKOFF_MAX=5000;
const SILENCE_MAX=6000;
/**
 * One browser socket for all bound symbols. Session snapshots supersede old
 * values; never silently fall back to simulator on network failure.
 */
export class TagStreamClient {
 private ws:WebSocket|null=null;
 private desired=false;
 private tags:string[]=[];
 private generation=0;
 private attempt=0;
 private retryTimer:ReturnType<typeof setTimeout>|null=null;
 private watchdog:ReturnType<typeof setInterval>|null=null;
 private lastServerMessage=0;
 private handshaken=false;
 constructor(private readonly hooks:TagStreamHooks,
  private readonly makeSocket:()=>WebSocket=()=>{
    const scheme=location.protocol==='https:'?'wss:':'ws:';
    return new WebSocket(scheme+'//'+location.hostname+':8787/ws/tags');
  }){}
 start():void{
  if(this.desired)return;
  this.desired=true;this.connect();
 }
 stop():void{
  this.desired=false;this.generation++;this.clearTimers();
  const ws=this.ws;this.ws=null;
  if(ws){ws.onclose=null;ws.onerror=null;ws.onmessage=null;ws.onopen=null;ws.close();}
  this.handshaken=false;this.attempt=0;
  this.hooks.onReset();this.hooks.onStatus('disconnected');
 }
 setTags(ids:readonly string[]):void{
  const uniq=[...new Set(ids)];
  if(uniq.length>MAX_TAGS||uniq.some(tag=>!VALID_TAG.test(tag))){
   this.hooks.onStatus('disconnected');this.stop();return;
  }
  if(this.tags.length===uniq.length&&this.tags.every((t,i)=>t===uniq[i]))return;
  this.tags=uniq;
  this.subscribe();
 }
 private clearTimers():void{
  if(this.retryTimer!==null)clearTimeout(this.retryTimer);
  if(this.watchdog!==null)clearInterval(this.watchdog);
  this.retryTimer=null;this.watchdog=null;
 }
 private subscribe():void {
  const ws=this.ws;
  if(ws?.readyState===WebSocket.OPEN&&this.handshaken)
   ws.send(JSON.stringify({type:'subscribe',version:1,tags:this.tags}));
 }
 private connect():void{
  if(!this.desired)return;
  const generation=++this.generation;
  this.hooks.onStatus(this.attempt?'reconnecting':'connecting');
  let ws:WebSocket;
  try{ws=this.makeSocket();}
  catch{this.retry(generation);return;}
  this.ws=ws;this.handshaken=false;
  ws.onopen=()=>{
   if(generation!==this.generation)return;
   this.lastServerMessage=Date.now();
   this.hooks.onReset();
  };
  ws.onmessage=ev=>{
   if(generation!==this.generation)return;
   let message:ServerMessage;
   try{message=JSON.parse(String(ev.data)) as ServerMessage;}
   catch{ws.close(1002,'Malformed message');return;}
   if(!message||typeof message!=='object'){ws.close(1002);return;}
   if(message.type==='hello'){
    if(message.version!==1||message.source!=='DEMO'){
     ws.close(1002,'Unsupported stream');return;
    }
    this.handshaken=true;this.lastServerMessage=Date.now();
    this.subscribe();return;
   }
   if(!this.handshaken)return;
   if(message.type==='heartbeat'){
    this.lastServerMessage=Date.now();return;
   }
   if(message.type==='subscribed'){
    if(!Array.isArray(message.tags))return;
    this.lastServerMessage=Date.now();this.attempt=0;
    this.hooks.onStatus('connected');
    if(this.watchdog===null)this.watchdog=setInterval(()=>{
     if(this.ws!==ws||!this.desired)return;
     if(Date.now()-this.lastServerMessage>SILENCE_MAX)ws.close();
    },1000);
    return;
   }
   if(message.type==='sample'&&validSample(message.sample)&&
      this.tags.includes(message.sample.tagId)){
    const now=Date.now();
    this.lastServerMessage=now;
    this.hooks.onSample(message.sample,now);
   }
  };
  ws.onclose=()=>this.retry(generation);
  ws.onerror=()=>{if(ws.readyState===WebSocket.OPEN)ws.close();};
 }
 private retry(generation:number):void{
  if(generation!==this.generation||!this.desired)return;
  this.clearTimers();this.ws=null;this.handshaken=false;
  this.hooks.onReset();
  this.hooks.onStatus('reconnecting');
  const delay=Math.min(BACKOFF_MAX,250*2**Math.min(this.attempt++,5));
  this.retryTimer=setTimeout(()=>{this.retryTimer=null;this.connect();},delay);
 }
}
