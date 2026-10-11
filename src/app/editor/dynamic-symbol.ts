/**
 * Portable, executable-code-free stateful symbol format.
 * Paths, SVG markup, scripts and arbitrary URLs are intentionally unsupported.
 * Device adapters provide samples; this module only resolves visual state.
 */
import type {TagSample,TagQuality} from './visual-runtime.ts';
import {effectiveQuality} from './visual-runtime.ts';

export type DynamicState='OPEN'|'CLOSED'|'INTERMEDIATE'|'BAD_STATE';
export type PointMode='single-point'|'double-point';
export type Vec2=readonly [number,number];
export interface DynamicLine {
  readonly id:string;
  readonly kind:'line';
  readonly from:Vec2;
  readonly to:Vec2;
  readonly stroke:string;
  readonly strokeWidth:number;
}
export interface DynamicSymbol {
  readonly format:'web-hmi-symbol';
  readonly version:1;
  readonly id:string;
  readonly name:string;
  readonly category:'Substation'|'Custom';
  readonly viewBox:Vec2;
  readonly parts:readonly DynamicLine[];
  readonly movingPartId:string;
  readonly pivot:Vec2;
  readonly ports:{readonly top:Vec2;readonly bottom:Vec2};
  readonly states:Record<DynamicState,{readonly angle:number;readonly color:string}>;
  readonly profiles:{
    readonly singlePoint:readonly [DynamicState,DynamicState];
    readonly doublePoint:readonly [DynamicState,DynamicState,DynamicState,DynamicState];
  };
}
export interface DynamicAppearance {
  readonly quality:TagQuality|'UNBOUND';
  readonly state:DynamicState;
  readonly status:string;
  readonly angle:number;
  readonly color:string;
  readonly warning:boolean;
  readonly animate:boolean;
}
export const CB_ROTATING:DynamicSymbol={
  format:'web-hmi-symbol',version:1,id:'cb-rotating',
  name:'CB Rotating (SP / DP)',category:'Substation',viewBox:[100,100],
  parts:[
    {id:'upper',kind:'line',from:[50,4],to:[50,35],stroke:'#8cabb7',strokeWidth:3},
    {id:'lower',kind:'line',from:[50,65],to:[50,96],stroke:'#8cabb7',strokeWidth:3},
    {id:'blade',kind:'line',from:[50,35],to:[50,65],stroke:'#73c9e0',strokeWidth:4}
  ],
  movingPartId:'blade',pivot:[50,35],
  ports:{top:[50,4],bottom:[50,96]},
  states:{
    OPEN:{angle:-60,color:'#e8b36c'},
    CLOSED:{angle:0,color:'#65d7aa'},
    INTERMEDIATE:{angle:-30,color:'#f2c16b'},
    BAD_STATE:{angle:-30,color:'#fc7187'}
  },
  profiles:{
    singlePoint:['OPEN','CLOSED'],
    // IEC 61850 Dbpos: intermediate(0), off/open(1), on/closed(2), bad(3).
    doublePoint:['INTERMEDIATE','OPEN','CLOSED','BAD_STATE']
  }
};
const idPattern=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const colorPattern=/^#[A-Fa-f0-9]{6}$/;
const states:readonly DynamicState[]=['OPEN','CLOSED','INTERMEDIATE','BAD_STATE'];
const isObject=(x:unknown):x is Record<string,unknown>=>
  !!x&&typeof x==='object'&&!Array.isArray(x);
const finite=(x:unknown,min:number,max:number):x is number=>
  typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
const point=(x:unknown,w:number,h:number):x is Vec2=>
  Array.isArray(x)&&x.length===2&&finite(x[0],0,w)&&finite(x[1],0,h);
const validProfile=(x:unknown,length:number):x is DynamicState[] =>
  Array.isArray(x)&&x.length===length&&x.every(s=>states.includes(s as DynamicState));
/** Recreates only allowlisted primitive fields; imported objects cannot inject code. */
export function parseDynamicSymbol(value:unknown):DynamicSymbol {
  if(!isObject(value)||value.format!=='web-hmi-symbol'||value.version!==1||
    typeof value.id!=='string'||!idPattern.test(value.id)||
    typeof value.name!=='string'||!value.name.trim()||value.name.length>80||
    (value.category!=='Substation'&&value.category!=='Custom')||
    !Array.isArray(value.viewBox)||value.viewBox.length!==2||
    !finite(value.viewBox[0],10,2000)||!finite(value.viewBox[1],10,2000))
    throw Error('Invalid dynamic symbol header');
  const [w,h]=value.viewBox as [number,number];
  if(!Array.isArray(value.parts)||value.parts.length<1||value.parts.length>64)
    throw Error('Symbol requires 1–64 vector lines');
  const seen=new Set<string>();
  const parts:DynamicLine[]=value.parts.map((raw:unknown)=>{
    if(!isObject(raw)||raw.kind!=='line'||typeof raw.id!=='string'||
      !idPattern.test(raw.id)||seen.has(raw.id)||!point(raw.from,w,h)||
      !point(raw.to,w,h)||typeof raw.stroke!=='string'||
      !colorPattern.test(raw.stroke)||!finite(raw.strokeWidth,0.2,20))
      throw Error('Invalid line part');
    seen.add(raw.id);
    if(raw.from[0]===raw.to[0]&&raw.from[1]===raw.to[1])
      throw Error('Zero-length vector line');
    return {id:raw.id,kind:'line',from:[...raw.from] as [number,number],
      to:[...raw.to] as [number,number],stroke:raw.stroke,strokeWidth:raw.strokeWidth};
  });
  if(typeof value.movingPartId!=='string'||!seen.has(value.movingPartId)||
     !point(value.pivot,w,h)||!isObject(value.ports)||
     !point(value.ports.top,w,h)||!point(value.ports.bottom,w,h)||
     !isObject(value.states)||!isObject(value.profiles)||
     !validProfile(value.profiles.singlePoint,2)||
     !validProfile(value.profiles.doublePoint,4))
    throw Error('Invalid symbol pivot, ports or profiles');
  const mapped={} as Record<DynamicState,{angle:number;color:string}>;
  for(const name of states){
    const raw=value.states[name];
    if(!isObject(raw)||!finite(raw.angle,-360,360)||
      typeof raw.color!=='string'||!colorPattern.test(raw.color))
      throw Error('Invalid symbol state: '+name);
    mapped[name]={angle:raw.angle,color:raw.color};
  }
  return {format:'web-hmi-symbol',version:1,id:value.id,name:value.name,
    category:value.category,viewBox:[w,h],parts,
    movingPartId:value.movingPartId,pivot:[...value.pivot] as [number,number],
    ports:{top:[...value.ports.top] as [number,number],
      bottom:[...value.ports.bottom] as [number,number]},
    states:mapped,profiles:{
      singlePoint:[...value.profiles.singlePoint] as [DynamicState,DynamicState],
      doublePoint:[...value.profiles.doublePoint] as
        [DynamicState,DynamicState,DynamicState,DynamicState]
    }};
}
export function findDynamicSymbol(id:string|undefined,
  custom:readonly DynamicSymbol[]=[]):DynamicSymbol|undefined{
  if(!id)return undefined;
  if(id==='cb-rotating')return CB_ROTATING;
  return custom.find(symbol=>symbol.id===id);
}
export function resolveDynamicState(def:DynamicSymbol,mode:PointMode,
  sample:TagSample|undefined,nowMs:number,preview:boolean,bound:boolean):DynamicAppearance{
  let quality:DynamicAppearance['quality']='UNBOUND';
  let state:DynamicState='OPEN';
  let status='DESIGN';
  if(preview&&bound){
    quality=effectiveQuality(sample,nowMs);
    if(quality==='GOOD'){
      const raw=sample?.value;
      const value=raw===true?1:raw===false?0:raw;
      const profile=mode==='single-point'?def.profiles.singlePoint:def.profiles.doublePoint;
      state=typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<profile.length?
        profile[value]!:'BAD_STATE';
      status=state;
    }else{
      state='BAD_STATE';
      status=quality;
    }
  }
  const warning=quality!=='GOOD'&&quality!=='UNBOUND'||state==='BAD_STATE'||state==='INTERMEDIATE';
  const color=quality==='BAD'?'#fc7187':
    quality==='STALE'?'#9a98ae':
    quality==='UNCERTAIN'?'#f2c16b':def.states[state].color;
  return {quality,state,status,angle:def.states[state].angle,color,warning,
    animate:quality==='GOOD'&&(state==='OPEN'||state==='CLOSED')};
}
/** Compose portable vector symbol from the editor's existing line objects. */
export function composeLineSymbol(lines:readonly {id:string;x:number;y:number;width:number;
  height:number;stroke:string}[],name:string,movingId:string,pivot:Vec2,
  openAngle:number):DynamicSymbol{
  if(lines.length<1||lines.length>64||!lines.some(l=>l.id===movingId)||
    !finite(openAngle,-360,360)||!name.trim()||name.length>80)
    throw Error('Select valid line shapes and one moving blade');
  const minX=Math.min(...lines.map(l=>l.x)),minY=Math.min(...lines.map(l=>l.y));
  const maxX=Math.max(...lines.map(l=>l.x+l.width));
  const maxY=Math.max(...lines.map(l=>l.y+l.height));
  const w=Math.max(10,maxX-minX),h=Math.max(10,maxY-minY);
  const id='user-'+crypto.randomUUID().replaceAll('-','').slice(0,16);
  const parts=lines.map((l,i)=>({
    id:'part'+i,kind:'line' as const,
    from:[l.x-minX,l.y-minY] as [number,number],
    to:[l.x+l.width-minX,l.y+l.height-minY] as [number,number],
    stroke:l.stroke,strokeWidth:3
  }));
  const movingIndex=lines.findIndex(l=>l.id===movingId);
  const symbol:DynamicSymbol={
    format:'web-hmi-symbol',version:1,id,name:name.trim(),category:'Custom',
    viewBox:[w,h],parts,movingPartId:'part'+movingIndex,
    pivot:[pivot[0]-minX,pivot[1]-minY],
    ports:{top:[w/2,0],bottom:[w/2,h]},
    states:{
      OPEN:{angle:openAngle,color:'#e8b36c'},
      CLOSED:{angle:0,color:'#65d7aa'},
      INTERMEDIATE:{angle:openAngle/2,color:'#f2c16b'},
      BAD_STATE:{angle:openAngle/2,color:'#fc7187'}
    },
    profiles:{singlePoint:['OPEN','CLOSED'],
      doublePoint:['INTERMEDIATE','OPEN','CLOSED','BAD_STATE']}
  };
  return parseDynamicSymbol(symbol);
}
