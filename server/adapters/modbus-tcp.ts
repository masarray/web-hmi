/**
 * CP-09 read-only Modbus TCP poller (FC01/02/03/04).
 * Grouping/decoding are pure functions; this transport owns one serialized poll loop.
 */
import {Socket} from 'node:net';
import type {WireSample} from '../../src/shared/tag-protocol.ts';
import {validateModbusConfig,planReads,decodeTag,
 type ModbusConfig,type ReadGroup,type ReadFunction} from './modbus-codec.ts';
export {validateModbusConfig,planReads} from './modbus-codec.ts';
export type {RegisterTag,ModbusConfig,ReadGroup,DataType,WordOrder} from './modbus-codec.ts';

export type AdapterHealth='DISCONNECTED'|'CONNECTING'|'HEALTHY'|'DEGRADED';
export interface ReadOnlyAdapter {
 start():void;
 stop():Promise<void>;
 status():AdapterHealth;
}
export type SampleSink=(sample:WireSample)=>void;
export type HealthSink=(state:AdapterHealth)=>void;
const MAX_FRAME=260;
interface Pending {
 readonly transactionId:number;
 readonly functionCode:ReadFunction;
 readonly count:number;
 readonly resolve:(data:Buffer)=>void;
 readonly reject:(error:Error)=>void;
 readonly timer:ReturnType<typeof setTimeout>;
}
export class ModbusTcpReadAdapter implements ReadOnlyAdapter {
 private readonly config:Required<ModbusConfig>;
 private readonly reads:readonly ReadGroup[];
 private state:AdapterHealth='DISCONNECTED';
 private running=false;
 private socket:Socket|null=null;
 private pending:Pending|null=null;
 private received=Buffer.alloc(0);
 private transaction=0;
 private sequence=0;
 private failures=0;
 private delay:ReturnType<typeof setTimeout>|null=null;
 private waitDone:(()=>void)|null=null;
 private loop:Promise<void>|null=null;
 private readonly emit:SampleSink;
 private readonly health:HealthSink;
 constructor(config:ModbusConfig,emit:SampleSink,health:HealthSink=()=>{}) {
  this.config=validateModbusConfig(config);
  this.reads=planReads(this.config.tags);
  this.emit=emit;
  this.health=health;
 }
 status():AdapterHealth{return this.state;}
 private setState(state:AdapterHealth):void {
  if(this.state===state)return;
  this.state=state;this.health(state);
 }
 private emitUnavailable():void {
  for(const tag of this.config.tags){
   this.emit({tagId:tag.tagId,value:null,quality:'BAD',sequence:++this.sequence});
  }
 }
 private disconnect(error=new Error('Modbus disconnected')):void {
  const pending=this.pending;
  if(pending){
   this.pending=null;clearTimeout(pending.timer);pending.reject(error);
  }
  const s=this.socket;this.socket=null;this.received=Buffer.alloc(0);
  if(s){s.removeAllListeners();s.destroy();}
 }
 private onData(chunk:Buffer):void {
  if(!this.pending)return;
  this.received=Buffer.concat([this.received,chunk]);
  if(this.received.length>MAX_FRAME){this.disconnect(new Error('Oversized Modbus frame'));return;}
  if(this.received.length<7)return;
  const length=this.received.readUInt16BE(4);
  const total=6+length;
  if(length<3||total>MAX_FRAME){this.disconnect(new Error('Invalid Modbus length'));return;}
  if(this.received.length<total)return;
  // The adapter never pipelines, so another complete frame is unsolicited.
  if(this.received.length!==total){this.disconnect(new Error('Unsolicited Modbus response'));return;}
  const frame=this.received;this.received=Buffer.alloc(0);
  const pending=this.pending;
  if(!pending)return;
  this.pending=null;clearTimeout(pending.timer);
  if(frame.readUInt16BE(0)!==pending.transactionId||
    frame.readUInt16BE(2)!==0||frame[6]!==this.config.unitId){
    pending.reject(new Error('Mismatched Modbus response'));return;
  }
  const fn=frame[7];
  if(fn===(pending.functionCode|0x80)){
   pending.reject(new Error('Modbus exception '+String(frame[8])));return;
  }
  const expected=pending.functionCode<=2?
    Math.ceil(pending.count/8):pending.count*2;
  if(fn!==pending.functionCode||frame[8]!==expected||
    frame.length!==9+expected){
   pending.reject(new Error('Invalid Modbus response payload'));return;
  }
  pending.resolve(frame.subarray(9));
 }
 private async connect():Promise<void>{
  if(this.socket&&!this.socket.destroyed)return;
  this.setState('CONNECTING');
  const socket=new Socket();
  this.socket=socket;
  await new Promise<void>((resolve,reject)=>{
   let settled=false;
   const finish=(err?:Error)=>{
    if(settled)return;settled=true;clearTimeout(timer);
    socket.off('connect',onConnect);socket.off('error',onError);
    if(err)reject(err);else resolve();
   };
   const onConnect=()=>finish();
   const onError=(err:Error)=>finish(err);
   const timer=setTimeout(()=>finish(new Error('Modbus connect timeout')),
    this.config.requestTimeoutMs);
   socket.once('connect',onConnect);socket.once('error',onError);
   socket.connect(this.config.port,this.config.host);
  });
  if(!this.running){socket.destroy();throw Error('Adapter stopped');}
  socket.setNoDelay(true);
  socket.on('data',(chunk:Buffer)=>this.onData(chunk));
  socket.on('error',(err:Error)=>this.disconnect(err));
  socket.on('close',()=>this.disconnect());
 }
 private read(group:ReadGroup):Promise<Buffer> {
  const socket=this.socket;
  if(!socket||socket.destroyed||this.pending)
   return Promise.reject(new Error('Modbus transport unavailable'));
  const transactionId=this.transaction=(this.transaction+1)&65535;
  const frame=Buffer.alloc(12);
  frame.writeUInt16BE(transactionId,0);
  frame.writeUInt16BE(0,2); // Modbus protocol ID
  frame.writeUInt16BE(6,4); // 1 unit + 5 PDU bytes
  frame[6]=this.config.unitId;frame[7]=group.functionCode;
  frame.writeUInt16BE(group.start,8);frame.writeUInt16BE(group.count,10);
  return new Promise<Buffer>((resolve,reject)=>{
   const timer=setTimeout(()=>this.disconnect(new Error('Modbus read timeout')),
     this.config.requestTimeoutMs);
   this.pending={transactionId,functionCode:group.functionCode,
    count:group.count,resolve,reject,timer};
   socket.write(frame);
  });
 }
 private async sleep(ms:number):Promise<void>{
  if(!this.running)return;
  await new Promise<void>(resolve=>{
   this.waitDone=resolve;
   this.delay=setTimeout(()=>{
    this.delay=null;this.waitDone=null;resolve();
   },ms);
  });
 }
 private async pollLoop():Promise<void>{
  while(this.running){
   try{
    await this.connect();
    for(const read of this.reads){
     if(!this.running)break;
     const bytes=await this.read(read);
     if(!this.running)break;
     for(const tag of read.tags){
      const value=decodeTag(read,bytes,tag);
      this.emit({tagId:tag.tagId,value,quality:'GOOD',sequence:++this.sequence});
     }
    }
    if(!this.running)break;
    this.failures=0;this.setState('HEALTHY');
    await this.sleep(this.config.pollMs);
   }catch{
    this.disconnect();
    if(!this.running)break;
    this.failures++;
    this.setState('DEGRADED');
    this.emitUnavailable();
    const backoff=Math.min(this.config.reconnectMaxMs,
      this.config.pollMs*2**Math.min(this.failures-1,6));
    await this.sleep(backoff);
   }
  }
  this.disconnect();
  this.setState('DISCONNECTED');
 }
 start():void{
  if(this.running)return;
  this.running=true;
  this.loop=this.pollLoop();
 }
 async stop():Promise<void>{
  this.running=false;
  if(this.delay!==null)clearTimeout(this.delay);
  this.delay=null;
  const done=this.waitDone;this.waitDone=null;done?.();
  this.disconnect(new Error('Modbus adapter stopped'));
  await this.loop;
  this.loop=null;
 }
}
