/** UTC-day partitioned JSONL: streaming reads and bounded retention, no SQLite package. */
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,
 appendFileSync,readdirSync,statSync,createReadStream} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {validateTrendConfig,type TrendConfig,type TrendRecord}
 from '../src/shared/trend-contract.ts';
import {VALID_TAG} from '../src/shared/tag-protocol.ts';
import type {TrendStore} from './trend-historian.ts';
const MAX_DAY_BYTES=128*1024*1024;
const FILE=/^trend-(\d{8})\.jsonl$/;
const CONFIG='historian-config.json';
function dateKey(timestamp:number):string{
 return new Date(timestamp).toISOString().slice(0,10).replaceAll('-','');
}
function atomicWrite(path:string,text:string):void{
 const temp=path+'.tmp-'+randomBytes(6).toString('hex');
 try{writeFileSync(temp,text,{mode:0o600,flag:'wx'});renameSync(temp,path);}
 catch(error){try{unlinkSync(temp);}catch{}throw error;}
}
export function createTrendFileStore(directory=resolve(process.cwd(),'config')):{
 store:TrendStore;restore:()=>{revision:number;config:TrendConfig}|undefined
}{
 const root=join(directory,'historian');
 mkdirSync(root,{recursive:true});
 let lastPrune='';
 const store:TrendStore={
  saveConfig(config,revision){
   atomicWrite(join(directory,CONFIG),
    JSON.stringify({revision,...validateTrendConfig(config)})+'\n');
  },
  append(points,days){
   const byDay=new Map<string,TrendRecord[]>();
   for(const point of points){
    const key=dateKey(point.t);
    let list=byDay.get(key);if(!list){list=[];byDay.set(key,list);}
    list.push(point);
   }
   for(const [day,records] of byDay){
    const file=join(root,'trend-'+day+'.jsonl');
    const data=records.map(r=>JSON.stringify(r)).join('\n')+'\n';
    if((existsSync(file)?statSync(file).size:0)+Buffer.byteLength(data)>MAX_DAY_BYTES)
     throw Error('Historian daily storage capacity reached');
    appendFileSync(file,data,{encoding:'utf8',mode:0o600});
   }
   const today=dateKey(Date.now());
   if(today!==lastPrune){
    lastPrune=today;
    const floor=dateKey(Date.now()-days*86400000);
    for(const file of readdirSync(root))
     if(FILE.test(file)&&file.slice(6,14)<floor)unlinkSync(join(root,file));
   }
  },
  async *read(from,to){
   const files=readdirSync(root).filter(name=>{
    const m=FILE.exec(name);
    return m && m[1]!>=dateKey(from) && m[1]!<=dateKey(to);
   }).sort();
   for(const name of files){
    const file=join(root,name);
    const stream=createReadStream(file,{encoding:'utf8'});
    const lines=createInterface({input:stream,crlfDelay:Infinity});
    try{
     for await(const line of lines){
      if(!line)continue;
      if(line.length>4096)throw Error('Oversized historian record');
      const x=JSON.parse(line) as TrendRecord;
      if(!x||!Number.isSafeInteger(x.t)||typeof x.tagId!=='string'||
       !VALID_TAG.test(x.tagId)||!['GOOD','UNCERTAIN','BAD','STALE'].includes(x.q)||
       (x.v!==null&&typeof x.v!=='boolean'&&
         !(typeof x.v==='number'&&Number.isFinite(x.v))))
       throw Error('Corrupted historian record');
      if(x.t>=from&&x.t<=to)yield x;
     }
    }finally{lines.close();stream.destroy();}
   }
  }
 };
 const restore=()=>{
  const file=join(directory,CONFIG);
  if(!existsSync(file))return undefined;
  const text=readFileSync(file,'utf8');
  if(text.length>8192)throw Error('Historian settings oversized');
  const obj=JSON.parse(text) as Record<string,unknown>;
  if(!Number.isSafeInteger(obj.revision)||(obj.revision as number)<0)
   throw Error('Invalid historian revision');
  return {revision:obj.revision as number,config:validateTrendConfig({
   tags:obj.tags,sampleMs:obj.sampleMs,retentionDays:obj.retentionDays
  })};
 };
 return {store,restore};
}
