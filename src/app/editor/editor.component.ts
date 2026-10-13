import { ChangeDetectionStrategy, Component, ElementRef, HostListener,
  ViewChild, computed, signal, effect, OnDestroy } from '@angular/core';
import { Project, Shape, ShapeKind, ShapeEdit, initialProject, parseProject,
  newShape, newSymbol, newVectorInstance, insertShape, editShape, deleteShape, createPage } from './document';
import {HMI_SYMBOLS,SYMBOL_CATEGORIES,filterSymbols,findSymbol,type SymbolCategory} from './symbols';
import {findProcessGraphic,PROCESS_GRAPHIC_COUNT} from './process-graphics';
import {TagStreamClient,type StreamStatus} from './tag-stream-client';
import {validateTrendConfig,type TrendConfig,type TrendStatus,
 type TrendResult} from '../../shared/trend-contract.ts';
import {validateAlarmConfig,type AlarmRule,type AlarmSnapshot,
 type AlarmCondition,type AlarmSeverity} from '../../shared/alarm-contract.ts';
import {CB_ROTATING,parseDynamicSymbol,findDynamicSymbol,resolveDynamicState,
  composeLineSymbol,type DynamicSymbol,type DynamicAppearance,type PointMode} from './dynamic-symbol';
import {qualifiedTag,validateFleet,type FleetDevice} from '../../shared/device-fleet.ts';
import {validateModbusConfig,planReads,widthOf,dataTypeOf,
  type ModbusConfig,type RegisterTag,type ReadFunction,
  type DataType,type WordOrder} from '../../shared/modbus-mapping.ts';
import {evaluatePage,evaluatePartAppearance,updateTagSample,
  nextFreshnessDeadline,STALE_AFTER_MS,type TagQuality,type TagTable,
  type VisualState,type PartEffect,type PartAppearance} from './visual-runtime';
import { duplicateShape, reorderShape, renamePage, renameProject, deletePage } from './actions';
import { alignObjects, distributeObjects, moveObjects, deleteObjects, type Align, type Axis } from './selection-ops';
import {SymbolStudioComponent} from './symbol-studio.component';
import {parseVectorSymbolJson,type VectorSymbol} from './symbol-studio-model';
import {projectVectorFrame,vectorSymbolIdAllowed,type RenderVectorSymbol} from './vector-runtime';

const STORAGE_KEY='web-hmi.project.v1';
const MODBUS_KEY='web-hmi.modbus-map.v1';
const FLEET_KEY='web-hmi.fleet.v1';
const MAX_FLEET_BYTES=524288;
interface FleetSummary {
 revision:number;busy:boolean;
 devices:(FleetDevice & {health:string;diagnostics?:DeviceDiagnosticsView|null})[];
}
function restoreFleetDraft():FleetDevice[]{
 try{
  const raw=localStorage.getItem(FLEET_KEY);
  if(raw&&raw.length<=MAX_FLEET_BYTES)return [...validateFleet(JSON.parse(raw)).devices];
 }catch{/* Ignore invalid browser-only draft; never connect automatically. */}
 return [{id:'PLC1',name:'PLC 1',config:defaultMapping()}];
}
const MAX_MAPPING_BYTES=131072;
type MappingField='tagId'|'functionCode'|'address'|'dataType'|'wordOrder';
type DeviceField='host'|'port'|'unitId'|'pollMs'|'requestTimeoutMs';
interface DeviceDiagnosticsView {
 successfulReads:number;completedCycles:number;consecutiveFailures:number;
 lastSuccessAt:number|null;lastFailureAt:number|null;
 lastError:string|null;lastCycleMs:number|null;
}
const REGISTER_TYPES:readonly DataType[]=['uint16','int16','uint32','int32','float32'];
function defaultMapping():ModbusConfig {
 return {host:'127.0.0.1',port:502,unitId:1,pollMs:1000,
  requestTimeoutMs:800,tags:[{tagId:'Plant/Motor',functionCode:3,address:0,dataType:'uint16'}]};
}
function restoreMapping():ModbusConfig {
 try{
  const raw=localStorage.getItem(MODBUS_KEY);
  if(raw && raw.length<MAX_MAPPING_BYTES)
   return validateModbusConfig(JSON.parse(raw) as ModbusConfig);
 }catch{/* invalid local data never activates industrial connections */}
 return defaultMapping();
}

type Drag={id:string;pointerId:number;startX:number;startY:number;original:Shape;members:Shape[];mode:'move'|'resize'};
type DragPreview={id:string;x:number;y:number;width:number;height:number};

@Component({
  selector:'hmi-root', standalone:true, imports:[SymbolStudioComponent],
  templateUrl:'./editor.component.html',
  styleUrl:'./editor.component.css',
  changeDetection:ChangeDetectionStrategy.OnPush
})
export class EditorComponent implements OnDestroy {
  @ViewChild('viewport') viewport?:ElementRef<SVGSVGElement>;
  readonly project=signal<Project>(this.restore());
  readonly selectedIds=signal<string[]>([]);
  readonly selectedId=computed(()=>this.selectedIds().length===1?this.selectedIds()[0]??null:null);
  readonly selectionCount=computed(()=>this.selectedIds().length);
  readonly selectionLookup=computed(()=>new Set(this.selectedIds()));
  readonly snapEnabled=signal(true);
  readonly gridVisible=signal(true);
  readonly previewMode=signal(false);
  readonly previewSource=signal<'local'|'server'>('local');
  readonly serverStatus=signal<StreamStatus>('disconnected');
  readonly serverKind=signal<'DEMO'|'MODBUS_LAB'|'MODBUS_TCP'>('DEMO');
  readonly serverSamples=signal<TagTable>(new Map());
  /** Transient test-feed, never saved to project or undo history. */
  readonly simulatedSamples=signal<TagTable>(new Map());
  readonly freshnessClock=signal(Date.now());
  private freshnessTimer:ReturnType<typeof setTimeout>|null=null;
  readonly simulatedTagChoice=signal('');
  readonly simulatedQuality=signal<TagQuality>('GOOD');
  readonly simulatedValue=signal(1);
  readonly boundTags=computed(()=>[...new Set(this.activePage().shapes
    .filter(s=>s.kind==='symbol'&&s.tagId.trim().length>0).map(s=>s.tagId))]);
  readonly simulatedTag=computed(()=>{
    const chosen=this.simulatedTagChoice();
    return this.boundTags().includes(chosen)?chosen:(this.boundTags()[0]??'');
  });
  readonly activeSamples=computed(()=>this.previewSource()==='server'
    ?this.serverSamples():this.simulatedSamples());
  readonly visualStates=computed(()=>evaluatePage(
    this.activePage().shapes,this.activeSamples(),this.previewMode(),
    this.freshnessClock()));
  /** Single indexed definition catalog shared across all symbol instances. */
  readonly dynamicCatalog=computed(()=>{
    const items=[CB_ROTATING,...(this.project().customSymbols??[])];
    return new Map(items.map(def=>[def.id,def] as const));
  });
  readonly dynamicStates=computed(()=>{
    const result=new Map<string,DynamicAppearance>();
    const catalog=this.dynamicCatalog();
    const samples=this.activeSamples(),now=this.freshnessClock(),preview=this.previewMode();
    for(const shape of this.activePage().shapes){
      if(shape.kind!=='symbol')continue;
      const def=catalog.get(shape.symbolId??'');
      if(def)result.set(shape.id,resolveDynamicState(def,shape.pointMode??'double-point',
        samples.get(shape.tagId),now,preview,!!shape.tagId));
    }
    return result;
  });
  /** Recomputed only when a shape or tag state actually changes. */
  readonly partAppearances=computed(()=>{
    const visuals=this.visualStates();
    const result=new Map<string,readonly PartAppearance[]>();
    for(const shape of this.activePage().shapes){
      const graphic=findProcessGraphic(shape.symbolId);
      const visual=visuals.get(shape.id);
      if(shape.kind==='symbol'&&graphic&&visual){
        result.set(shape.id,graphic.parts.map((part,index)=>
          evaluatePartAppearance(shape,part,index,visual,this.previewMode())));
      }
    }
    return result;
  });
  readonly zoom=signal(1);
  readonly status=signal('Editor ready · local project');
  readonly canUndo=signal(false);
  readonly canRedo=signal(false);
  readonly activePage=computed(()=>
    this.project().pages.find(p=>p.id===this.project().activePageId)!);
  readonly selected=computed(()=>
    this.activePage().shapes.find(s=>s.id===this.selectedId())??null);
  readonly preview=signal<DragPreview|null>(null);
  readonly dragOffsets=signal<Record<string,{x:number;y:number}>>({});
  readonly trendOpen=signal(false);
  readonly trendBusy=signal(false);
  readonly trendMessage=signal('Connect to configure trends');
  readonly trendStatus=signal<TrendStatus|null>(null);
  readonly trendDraft=signal<TrendConfig>({tags:[],sampleMs:2000,retentionDays:3});
  readonly trendData=signal<TrendResult|null>(null);
  readonly trendMinutes=signal<15|60|360|1440>(60);
  readonly trendCandidate=signal('');
  readonly trendGraph=computed(()=>{
    const source=this.trendData();
    if(!source)return {min:0,max:1,lines:[] as {id:string;color:string;path:string}[]};
    const values=source.series.flatMap(series=>series.points
      .filter(p=>p.q==='GOOD'&&p.v!==null).map(p=>Number(p.v)));
    const min=values.length?Math.min(...values):0;
    const max=values.length?Math.max(...values):1;
    const span=Math.max(1e-9,max-min);
    const colors=['#65d4ec','#f5be75','#a6e2ad','#b4a4ef',
      '#ed829e','#e0d386','#76b2ed','#c7d1df'];
    return {min,max,lines:source.series.map((series,i)=>{
      let path='',drawing=false;
      for(const point of series.points){
        if(point.q!=='GOOD'||point.v===null){drawing=false;continue;}
        const x=48+(point.t-source.from)/(source.to-source.from)*870;
        const y=260-(Number(point.v)-min)/span*228;
        if(!Number.isFinite(x)||!Number.isFinite(y))continue;
        path+=(drawing?' L':'M')+x.toFixed(2)+' '+y.toFixed(2);
        drawing=true;
      }
      return {id:series.tagId,color:colors[i%colors.length]!,path};
    })};
  });
  private trendTimer:ReturnType<typeof setInterval>|null=null;
  readonly alarmOpen=signal(false);
  readonly alarmBusy=signal(false);
  readonly alarmMessage=signal('Connect with your server key to view alarms');
  readonly alarms=signal<AlarmSnapshot|null>(null);
  readonly alarmDraft=signal<AlarmRule[]>([]);
  readonly alarmHistoryOpen=signal(false);
  readonly alarmUnacknowledged=computed(()=>this.alarms()?.unacknowledged??0);
  readonly alarmRulesValid=computed(()=>{
    try{validateAlarmConfig({rules:this.alarmDraft()});return true;}
    catch{return false;}
  });
  private alarmTimer:ReturnType<typeof setInterval>|null=null;
  readonly mappingOpen=signal(false);
  readonly symbolBuilderOpen=signal(false);
  readonly symbolStudioOpen=signal(false);
  readonly studioSource=signal<VectorSymbol|null>(null);
  readonly vectorCatalog=computed(()=>new Map(
    (this.project().vectorSymbols??[]).map(def=>[def.id,def] as const)));
  readonly vectorFrames=computed(()=>{
    const result=new Map<string,RenderVectorSymbol>();
    const catalog=this.vectorCatalog();
    const samples=this.activeSamples(),now=this.freshnessClock();
    for(const shape of this.activePage().shapes){
      const def=catalog.get(shape.symbolId??'');
      if(def)result.set(shape.id,projectVectorFrame(def,
        shape.pointMode??'double-point',samples.get(shape.tagId),
        now,this.previewMode(),!!shape.tagId));
    }
    return result;
  });
  readonly symbolBuilderName=signal('My Circuit Breaker');
  readonly symbolBuilderMoving=signal('');
  readonly symbolBuilderPivotX=signal(0);
  readonly symbolBuilderPivotY=signal(0);
  readonly symbolBuilderOpenAngle=signal(-60);
  readonly symbolBuilderLines=computed(()=>this.activePage().shapes.filter(s=>
    this.selectedIds().includes(s.id)&&s.kind==='line'));
  readonly symbolBuilderPossible=computed(()=>this.selectionCount()>0&&
    this.symbolBuilderLines().length===this.selectionCount());
  readonly fleetMode=signal(false);
  readonly fleetDraft=signal<FleetDevice[]>(restoreFleetDraft());
  readonly fleetSelected=signal<string>('PLC1');
  readonly fleetRevision=signal<number|null>(null);
  readonly selectedFleetName=computed(()=>this.fleetDraft().find(d=>d.id===this.fleetSelected())?.name??'');
  readonly fleetBusy=signal(false);
  readonly fleetStatus=signal('Add PLCs and configure their tags');
  readonly fleetHealth=signal<FleetSummary['devices']>([]);
  readonly fleetValidation=computed(()=>{
    try{return {ok:true,problem:'',fleet:validateFleet({devices:this.fleetDraft()})};}
    catch(error){return {ok:false,problem:error instanceof Error?error.message:String(error),
      fleet:null};}
  });
  readonly availableMappingTags=computed(()=>{
    if(this.fleetMode())return this.fleetDraft().flatMap(dev=>
      dev.config.tags.map(tag=>({id:qualifiedTag(dev.id,tag.tagId),
        label:dev.name+' / '+tag.tagId})));
    return this.mappingDraft().tags.map(tag=>({
      id:tag.tagId,label:tag.tagId+' · FC'+tag.functionCode+' @ '+tag.address}));
  });
  readonly mappingDraft=signal<ModbusConfig>(restoreMapping());
  readonly mappingSearch=signal('');
  readonly mappingLimit=signal(40);
  readonly mappingStatus=signal('Edit mapping and apply it directly to the configured server');
  readonly adminToken=signal('');
  readonly deviceRevision=signal<number|null>(null);
  readonly deviceHealth=signal('NOT CONNECTED');
  readonly deviceBusy=signal(false);
  readonly deviceConfigured=signal(false);
  readonly deviceDiagnostics=signal<DeviceDiagnosticsView|null>(null);
  readonly deviceProbeStatus=signal('');
  readonly deviceHealthLabel=computed(()=>{
    const health=this.deviceHealth();
    return health==='HEALTHY'?'Online':health==='CONNECTING'?'Connecting':
      health==='DEGRADED'?'Connection problem':
      health==='DISCONNECTED'?'Offline':
      health==='UNCONFIGURED'?'Not configured':'Not connected';
  });
  readonly mappingTypes=REGISTER_TYPES;
  readonly mappingValidation=computed(()=>{
    try{
      const safe=validateModbusConfig(this.mappingDraft());
      const groups=planReads(safe.tags);
      return {ok:true,problem:'',requestCount:groups.length,groups};
    }catch(error){
      return {ok:false,problem:error instanceof Error?error.message:String(error),
        requestCount:0,groups:[]};
    }
  });
  readonly mappingRows=computed(()=>{
    const q=this.mappingSearch().trim().toLowerCase();
    return this.mappingDraft().tags.map((tag,index)=>({tag,index}))
      .filter(item=>!q||item.tag.tagId.toLowerCase().includes(q)||
        String(item.tag.address).includes(q))
      .slice(0,this.mappingLimit());
  });
  readonly mappingMatches=computed(()=>{
    const q=this.mappingSearch().trim().toLowerCase();
    return this.mappingDraft().tags.filter(tag=>!q||
      tag.tagId.toLowerCase().includes(q)||String(tag.address).includes(q)).length;
  });
  readonly symbolSearch=signal('');
  readonly symbolCategory=signal<SymbolCategory>('All');
  readonly symbolCategories=SYMBOL_CATEGORIES;
  readonly symbolTotal=HMI_SYMBOLS.length;
  readonly processGraphic=findProcessGraphic;
  readonly processGraphicTotal=PROCESS_GRAPHIC_COUNT;
  readonly symbolMatches=computed(()=>filterSymbols(this.symbolSearch(),this.symbolCategory()));
  readonly symbolLimit=signal(24);
  readonly symbolVisible=computed(()=>this.symbolMatches().slice(0,this.symbolLimit()));
  showMoreSymbols():void{this.symbolLimit.update(n=>Math.min(n+24,this.symbolTotal));}
  toggleMapping():void{
    if(this.previewMode())return;
    if(!this.mappingOpen()&&this.alarmOpen())this.toggleAlarmCenter();
    if(!this.mappingOpen()&&this.trendOpen())this.toggleTrends();
    this.mappingOpen.update(open=>!open);
    if(!this.mappingOpen())this.stopDeviceMonitor();
  }
  switchDeviceMode(multi:boolean):void{
    if(this.fleetMode()===multi)return;
    this.fleetMode.set(multi);
    this.mappingSearch.set('');
    this.mappingLimit.set(40);
    if(multi)this.selectFleetDevice(this.fleetDraft()[0]?.id??'');
    else this.mappingDraft.set(restoreMapping());
  }
  selectFleetDevice(id:string):void{
    const device=this.fleetDraft().find(d=>d.id===id);
    this.fleetSelected.set(device?.id??'');
    this.mappingDraft.set(device?.config??defaultMapping());
    this.mappingSearch.set('');
  }
  addFleetDevice():void{
    if(this.fleetDraft().length>=16){this.fleetStatus.set('Maximum 16 PLCs');return;}
    const used=new Set(this.fleetDraft().map(d=>d.id));
    let n=1;while(used.has('PLC'+n))n++;
    const newDevice:FleetDevice={id:'PLC'+n,name:'PLC '+n,config:defaultMapping()};
    this.saveFleetDraft([...this.fleetDraft(),newDevice]);
    this.selectFleetDevice(newDevice.id);
  }
  deleteFleetDevice():void{
    const id=this.fleetSelected();
    const next=this.fleetDraft().filter(d=>d.id!==id);
    this.saveFleetDraft(next);
    this.selectFleetDevice(next[0]?.id??'');
  }
  renameFleetDevice(event:Event):void{
    const name=(event.target as HTMLInputElement).value;
    this.saveFleetDraft(this.fleetDraft().map(d=>d.id===this.fleetSelected()?
      {...d,name}:d));
  }
  private saveFleetDraft(devices:FleetDevice[]):void{
    this.fleetDraft.set(devices);
    try{
      localStorage.setItem(FLEET_KEY,JSON.stringify(validateFleet({devices})));
      this.fleetStatus.set('PLC list saved on this browser');
    }catch(error){this.fleetStatus.set('Check PLC list: '+String(error));}
  }
  private async fleetRequest(path:string,body?:unknown):Promise<FleetSummary>{
    if(this.adminToken().length<32)throw Error('Enter server access key first');
    const port=location.port==='4200'?':8787':'';
    const url=location.protocol+'//'+location.hostname+port+'/api/fleet'+path;
    const response=await fetch(url,{
      method:body===undefined?'GET':'POST',mode:'cors',credentials:'omit',
      signal:AbortSignal.timeout(30000),
      headers:{Authorization:'Bearer '+this.adminToken(),
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const data=await response.json() as FleetSummary & {error?:string};
    if(!response.ok)throw Error(data.error??('Server HTTP '+response.status));
    return data;
  }
  async loadFleet():Promise<void>{
    if(this.fleetBusy())return;
    this.fleetBusy.set(true);
    try{
      const state=await this.fleetRequest('');
      this.fleetRevision.set(state.revision);
      this.fleetHealth.set(state.devices);
      if(state.devices.length){
        this.saveFleetDraft(state.devices.map(({id,name,config})=>({id,name,config})));
        this.selectFleetDevice(state.devices[0]!.id);
      }
      this.fleetStatus.set('Connected · '+state.devices.length+' PLCs on server');
    }catch(error){
      this.fleetRevision.set(null);
      this.fleetStatus.set('Server unavailable: '+String(error));
    }finally{this.fleetBusy.set(false);}
  }
  async applyFleet():Promise<void>{
    if(this.fleetBusy()||!this.fleetValidation().ok||this.fleetRevision()===null)return;
    this.fleetBusy.set(true);
    try{
      const state=await this.fleetRequest('/apply',{
        revision:this.fleetRevision(),devices:this.fleetValidation().fleet!.devices
      });
      this.fleetRevision.set(state.revision);
      this.fleetHealth.set(state.devices);
      this.fleetStatus.set('Saved on server · '+state.devices.length+' PLCs');
    }catch(error){
      this.fleetRevision.set(null);
      this.fleetStatus.set('No changes applied: '+String(error));
    }finally{this.fleetBusy.set(false);}
  }
  async testFleetDevice():Promise<void>{
    if(this.fleetBusy()||!this.fleetValidation().ok)return;
    const device=this.fleetDraft().find(d=>d.id===this.fleetSelected());
    if(!device)return;
    this.fleetBusy.set(true);
    try{
      const state=await this.fleetRequest('/test',{device});
      this.fleetStatus.set('PLC responding · '+(state as unknown as {latencyMs:number}).latencyMs+' ms');
    }catch(error){this.fleetStatus.set('PLC test failed: '+String(error));}
    finally{this.fleetBusy.set(false);}
  }
  showMoreMappings():void{
    this.mappingLimit.update(v=>Math.min(v+40,this.mappingDraft().tags.length));
  }
  searchMappings(event:Event):void{
    this.mappingSearch.set((event.target as HTMLInputElement).value);
    this.mappingLimit.set(40);
  }
  dataTypeOfMapping(tag:RegisterTag):DataType{return dataTypeOf(tag);}
  widthOfMapping(tag:RegisterTag):number{return widthOf(tag);}
  mappingTypesFor(fc:ReadFunction):readonly DataType[]{
    return fc<=2?['bool']:REGISTER_TYPES;
  }
  setDeviceField(field:DeviceField,event:Event):void{
    const input=event.target as HTMLInputElement;
    const value=field==='host'?input.value:Number(input.value);
    this.applyMapping({...this.mappingDraft(),[field]:value});
  }
  private applyMapping(next:ModbusConfig):void{
    this.mappingDraft.set(next);
    try{
      const safe=validateModbusConfig(next);
      if(this.fleetMode()){
        this.saveFleetDraft(this.fleetDraft().map(d=>
          d.id===this.fleetSelected()?{...d,config:safe}:d));
      }else localStorage.setItem(MODBUS_KEY,JSON.stringify(safe));
      this.mappingStatus.set('Mapping ready');
    }catch(error){
      this.mappingStatus.set('Fix mapping: '+String(error instanceof Error?error.message:error));
    }
  }
  setMappingField(index:number,field:MappingField,event:Event):void{
    const old=this.mappingDraft().tags[index];
    if(!old)return;
    const input=event.target as HTMLInputElement|HTMLSelectElement;
    const value=field==='address'||field==='functionCode'?Number(input.value):input.value;
    let changed:RegisterTag={...old,[field]:value};
    if(field==='functionCode'){
      const fc=value as ReadFunction;
      changed={...changed,dataType:fc<=2?'bool':'uint16',wordOrder:undefined};
    }
    if(field==='dataType'&&!['float32','int32','uint32'].includes(String(value)))
      changed={...changed,wordOrder:undefined};
    const tags=[...this.mappingDraft().tags];
    tags[index]=changed;
    this.applyMapping({...this.mappingDraft(),tags});
  }
  addMappedTag():void{
    const tags=this.mappingDraft().tags;
    if(tags.length>=128){this.mappingStatus.set('Maximum 128 tags per device');return;}
    const names=new Set(tags.map(t=>t.tagId));
    let count=1;
    while(names.has('Tag_'+count))count++;
    const last=tags.at(-1);
    const address=last?Math.min(65535,last.address+widthOf(last)):0;
    const next:RegisterTag={tagId:'Tag_'+count,functionCode:3,address,dataType:'uint16'};
    this.applyMapping({...this.mappingDraft(),tags:[...tags,next]});
    this.mappingSearch.set('');
    this.mappingLimit.set(Math.max(this.mappingLimit(),tags.length+1));
  }
  deleteMappedTag(index:number):void{
    this.applyMapping({...this.mappingDraft(),
      tags:this.mappingDraft().tags.filter((_,i)=>i!==index)});
  }
  bindMappedTag(event:Event):void{
    const id=(event.target as HTMLSelectElement).value;
    const selected=this.selected();
    if(!selected||!this.availableMappingTags().some(tag=>tag.id===id))return;
    try{
      this.record(editShape(this.project(),selected.id,{tagId:id}));
      this.status.set('Bound '+selected.name+' to '+id);
    }catch(error){this.status.set(String(error));}
  }
  deviceClock(timestamp:number):string{
    return Number.isFinite(timestamp)&&timestamp>0?
      new Date(timestamp).toLocaleTimeString():'—';
  }
  private deviceMonitor:ReturnType<typeof setInterval>|null=null;
  private stopDeviceMonitor():void{
    if(this.deviceMonitor!==null)clearInterval(this.deviceMonitor);
    this.deviceMonitor=null;
  }
  private startDeviceMonitor():void{
    if(this.deviceMonitor!==null)return;
    this.deviceMonitor=setInterval(()=>{
      if(this.mappingOpen()&&this.adminToken().length>=32&&!this.deviceBusy())
        void this.refreshDeviceMonitor();
    },4000);
  }
  private updateDeviceState(state:{revision:number;health:string;configured:boolean;
    diagnostics?:DeviceDiagnosticsView|null}):void{
    this.deviceRevision.set(state.revision);
    this.deviceHealth.set(state.health);
    this.deviceConfigured.set(state.configured);
    this.deviceDiagnostics.set(state.diagnostics??null);
  }
  private async refreshDeviceMonitor():Promise<void>{
    try{this.updateDeviceState(await this.deviceRequest('status'));}
    catch{
      this.deviceRevision.set(null);
      this.deviceHealth.set('DISCONNECTED');
      this.deviceDiagnostics.set(null);
    }
  }
  toggleTrends():void{
    const open=!this.trendOpen();
    if(open){
      if(this.mappingOpen())this.toggleMapping();
      if(this.alarmOpen())this.toggleAlarmCenter();
      this.trendOpen.set(true);
      if(this.adminToken().length>=32)void this.loadTrends();
      this.startTrendTimer();
    }else{
      this.trendOpen.set(false);
      this.stopTrendTimer();
    }
  }
  private stopTrendTimer():void{
    if(this.trendTimer!==null)clearInterval(this.trendTimer);
    this.trendTimer=null;
  }
  private startTrendTimer():void{
    if(this.trendTimer!==null)return;
    this.trendTimer=setInterval(()=>{
      if(this.trendOpen()&&this.trendMinutes()===15&&
        this.trendData()&&!this.trendBusy()&&this.adminToken().length>=32)
        void this.loadTrendChart(false);
    },10000);
  }
  private trendUrl(path=''):string{
    const port=location.port==='4200'?':8787':'';
    return location.protocol+'//'+location.hostname+port+'/api/trends'+path;
  }
  private async trendRequest<T>(path:string,body?:unknown):Promise<T>{
    if(this.adminToken().length<32)throw Error('Enter the server access key');
    const response=await fetch(this.trendUrl(path),{
      method:body===undefined?'GET':'POST',
      mode:'cors',credentials:'omit',signal:AbortSignal.timeout(30000),
      headers:{Authorization:'Bearer '+this.adminToken(),
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const data=await response.json() as T & {error?:string};
    if(!response.ok)throw Error(data.error??('Server HTTP '+response.status));
    return data;
  }
  async loadTrends():Promise<void>{
    if(this.trendBusy())return;
    this.trendBusy.set(true);
    let loadChart=false;
    try{
      const response=await this.trendRequest<TrendStatus>('');
      this.trendStatus.set(response);
      this.trendDraft.set(response.config);
      this.trendMessage.set('Historian connected');
      loadChart=response.config.tags.length>0;
    }catch(error){this.trendMessage.set('Unable to connect: '+String(error));}
    finally{this.trendBusy.set(false);}
    // Fetch only after the status request has released its busy guard.
    if(loadChart)void this.loadTrendChart(false);
  }
  setTrendCandidate(event:Event):void{
    this.trendCandidate.set((event.target as HTMLInputElement|HTMLSelectElement).value);
  }
  addTrendTag():void{
    const id=this.trendCandidate().trim();
    const current=this.trendDraft();
    if(!id||current.tags.includes(id)||current.tags.length>=8)return;
    try{
      const next=validateTrendConfig({...current,tags:[...current.tags,id]});
      this.trendDraft.set(next);this.trendCandidate.set('');
    }catch(error){this.trendMessage.set(String(error));}
  }
  removeTrendTag(id:string):void{
    this.trendDraft.update(prev=>({...prev,tags:prev.tags.filter(t=>t!==id)}));
  }
  changeTrendSetting(field:'sampleMs'|'retentionDays',event:Event):void{
    const value=Number((event.target as HTMLSelectElement).value);
    this.trendDraft.update(prev=>({...prev,[field]:value}));
  }
  changeTrendWindow(event:Event):void{
    const value=Number((event.target as HTMLSelectElement).value);
    if(value===15||value===60||value===360||value===1440)
      this.trendMinutes.set(value);
  }
  async saveTrendConfig():Promise<void>{
    const status=this.trendStatus();
    if(!status||this.trendBusy())return;
    this.trendBusy.set(true);
    try{
      const safe=validateTrendConfig(this.trendDraft());
      const next=await this.trendRequest<TrendStatus>('/config',{
        revision:status.revision,...safe
      });
      this.trendStatus.set(next);this.trendDraft.set(next.config);
      this.trendData.set(null);
      this.trendMessage.set('Recording settings saved');
    }catch(error){this.trendMessage.set('Cannot save: '+String(error));}
    finally{this.trendBusy.set(false);}
  }
  async loadTrendChart(showMessage=true):Promise<void>{
    const settings=this.trendStatus();
    if(!settings?.config.tags.length||this.trendBusy())return;
    this.trendBusy.set(true);
    try{
      const to=Date.now();
      const result=await this.trendRequest<TrendResult>('/query',{
        tags:settings.config.tags,from:to-this.trendMinutes()*60000,
        to,maxPoints:400
      });
      this.trendData.set(result);
      if(showMessage)this.trendMessage.set('Chart updated');
    }catch(error){this.trendMessage.set('Chart unavailable: '+String(error));}
    finally{this.trendBusy.set(false);}
  }
  toggleAlarmCenter():void{
    const show=!this.alarmOpen();
    this.alarmOpen.set(show);
    if(show){
      if(this.mappingOpen())this.toggleMapping();
      if(this.trendOpen())this.toggleTrends();
      if(this.adminToken().length>=32)void this.refreshAlarms();
      this.startAlarmTimer();
    }else this.stopAlarmTimer();
  }
  private stopAlarmTimer():void{
    if(this.alarmTimer!==null)clearInterval(this.alarmTimer);
    this.alarmTimer=null;
  }
  private startAlarmTimer():void{
    if(this.alarmTimer!==null)return;
    this.alarmTimer=setInterval(()=>{
      if(this.alarmOpen()&&this.adminToken().length>=32&&!this.alarmBusy())
        void this.refreshAlarms(false);
    },4000);
  }
  private alarmUrl(path=''):string{
    const port=location.port==='4200'?':8787':'';
    return location.protocol+'//'+location.hostname+port+'/api/alarms'+path;
  }
  private async alarmRequest(path:string,body?:unknown):Promise<AlarmSnapshot>{
    if(this.adminToken().length<32)throw Error('Enter the server access key');
    const response=await fetch(this.alarmUrl(path),{
      method:body===undefined?'GET':'POST',credentials:'omit',mode:'cors',
      signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+this.adminToken(),
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const data=await response.json() as AlarmSnapshot&{error?:string};
    if(!response.ok)throw Error(data.error??('Server HTTP '+response.status));
    if(!Number.isSafeInteger(data.revision)||!Array.isArray(data.rules)||
       !Array.isArray(data.active)||!Array.isArray(data.recent))
      throw Error('Invalid alarm status response');
    return data;
  }
  async refreshAlarms(message=true):Promise<void>{
    if(this.alarmBusy())return;
    this.alarmBusy.set(true);
    try{
      const snapshot=await this.alarmRequest('');
      this.alarms.set(snapshot);
      // Operator's unsaved editing is preserved on background refresh.
      if(message)this.alarmDraft.set([...snapshot.rules]);
      if(message)this.alarmMessage.set('Connected · '+snapshot.rules.length+' rules');
    }catch(error){
      this.alarmMessage.set('Cannot load alarms: '+String(error));
    }finally{this.alarmBusy.set(false);}
  }
  setAlarmRuleField(index:number,field:keyof AlarmRule,event:Event):void{
    const prev=this.alarmDraft()[index];
    if(!prev)return;
    const value=(event.target as HTMLInputElement|HTMLSelectElement).value;
    const data:AlarmRule={...prev,[field]:
      field==='threshold'||field==='hysteresis'?Number(value):value};
    this.alarmDraft.update(items=>items.map((item,i)=>i===index?data:item));
  }
  addAlarmRule():void{
    if(this.alarmDraft().length>=64)return;
    let i=1;const names=new Set(this.alarmDraft().map(x=>x.id));
    while(names.has('alarm'+i))i++;
    const tagId=this.availableMappingTags()[0]?.id??'Plant/Motor';
    this.alarmDraft.update(rules=>[...rules,{
      id:'alarm'+i,label:'Alarm '+i,tagId,condition:'above' as AlarmCondition,
      threshold:1,hysteresis:0,severity:'warning' as AlarmSeverity
    }]);
  }
  removeAlarmRule(index:number):void{
    this.alarmDraft.update(list=>list.filter((_,i)=>i!==index));
  }
  async saveAlarmRules():Promise<void>{
    const current=this.alarms();
    if(this.alarmBusy()||!current||!this.alarmRulesValid())return;
    this.alarmBusy.set(true);
    try{
      const response=await this.alarmRequest('/config',{
        revision:current.revision,rules:validateAlarmConfig({rules:this.alarmDraft()}).rules
      });
      this.alarms.set(response);this.alarmDraft.set([...response.rules]);
      this.alarmMessage.set('Alarm rules saved');
    }catch(error){this.alarmMessage.set('Save failed: '+String(error));}
    finally{this.alarmBusy.set(false);}
  }
  async acknowledgeAlarm(id:string):Promise<void>{
    if(this.alarmBusy())return;
    this.alarmBusy.set(true);
    try{
      this.alarms.set(await this.alarmRequest('/ack',{id}));
      this.alarmMessage.set('Alarm acknowledged');
    }catch(error){this.alarmMessage.set('Acknowledge failed: '+String(error));}
    finally{this.alarmBusy.set(false);}
  }
  alarmClock(time:number):string{
    return new Date(time).toLocaleTimeString();
  }
  setAdminToken(event:Event):void{
    this.stopDeviceMonitor();
    this.adminToken.set((event.target as HTMLInputElement).value);
    this.deviceRevision.set(null);
    this.deviceHealth.set('NOT CONNECTED');
    this.fleetRevision.set(null);
    this.deviceDiagnostics.set(null);
    this.deviceProbeStatus.set('');
    this.alarms.set(null);
    this.alarmDraft.set([]);
    this.trendStatus.set(null);this.trendData.set(null);
  }
  private deviceApiUrl(path:'status'|'apply'|'test'):string{
    // Dev serves Angular on :4200; production should proxy /api/device on the
    // same TLS origin as the HMI frontend, never to an arbitrary device host.
    const port=location.port==='4200'?':8787':'';
    return location.protocol+'//'+location.hostname+port+'/api/device/'+path;
  }
  private async deviceRequest(path:'status'|'apply',body?:unknown):Promise<{
    revision:number;health:string;configured:boolean;
    diagnostics?:DeviceDiagnosticsView|null
  }>{
    if(this.adminToken().length<32)throw Error('Enter an administrator token (32+ characters)');
    const response=await fetch(this.deviceApiUrl(path),{
      method:path==='apply'?'POST':'GET',mode:'cors',credentials:'omit',
      signal:AbortSignal.timeout(30000),
      headers:{Authorization:'Bearer '+this.adminToken(),
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const result=await response.json() as {
      revision?:number;health?:string;configured?:boolean;error?:string;
      diagnostics?:DeviceDiagnosticsView|null
    };
    if(!response.ok)throw Error(result.error??('Server HTTP '+response.status));
    if(!Number.isSafeInteger(result.revision)||typeof result.health!=='string'||
      typeof result.configured!=='boolean')throw Error('Invalid server response');
    return {revision:result.revision!,health:result.health,
      configured:result.configured,diagnostics:result.diagnostics};
  }
  async checkDeviceStatus():Promise<void>{
    if(this.deviceBusy())return;
    this.deviceBusy.set(true);
    try{
      const state=await this.deviceRequest('status');
      this.updateDeviceState(state);
      this.startDeviceMonitor();
      this.mappingStatus.set('Server connected');
    }catch(error){
      this.mappingStatus.set('Server status failed: '+String(error));
      this.deviceRevision.set(null);
      this.deviceHealth.set('DISCONNECTED');
      this.deviceDiagnostics.set(null);
      this.stopDeviceMonitor();
    }finally{this.deviceBusy.set(false);}
  }
  /** A full read-only test without replacing the running PLC source. */
  async testDeviceConnection():Promise<void>{
    if(this.deviceBusy()||!this.mappingValidation().ok||this.adminToken().length<32)return;
    this.deviceBusy.set(true);
    this.deviceProbeStatus.set('Testing PLC connection…');
    try{
      const response=await fetch(this.deviceApiUrl('test'),{
        method:'POST',mode:'cors',credentials:'omit',
        signal:AbortSignal.timeout(30000),
        headers:{Authorization:'Bearer '+this.adminToken(),'Content-Type':'application/json'},
        body:JSON.stringify({config:validateModbusConfig(this.mappingDraft())})
      });
      const result=await response.json() as {
        ok?:boolean;latencyMs?:number;readRequests?:number;error?:string
      };
      if(!response.ok||!result.ok||!Number.isFinite(result.latencyMs))
        throw Error(result.error??'PLC test failed');
      this.deviceProbeStatus.set('PLC responding · '+result.latencyMs+
        ' ms · '+result.readRequests+' read requests');
    }catch(error){
      this.deviceProbeStatus.set('PLC test failed · '+
        (error instanceof Error?error.message:String(error)));
    }finally{this.deviceBusy.set(false);}
  }
  async applyDeviceMapping():Promise<void>{
    if(this.deviceBusy()||!this.mappingValidation().ok||
      this.deviceRevision()===null)return;
    this.deviceBusy.set(true);
    try{
      const state=await this.deviceRequest('apply',{
        revision:this.deviceRevision(),config:validateModbusConfig(this.mappingDraft())
      });
      this.updateDeviceState(state);
      this.mappingStatus.set('Configuration applied · revision '+state.revision+
        ' · source '+state.health);
    }catch(error){
      this.mappingStatus.set('Apply failed; previous source retained: '+String(error));
      this.deviceRevision.set(null); // explicit reconnect prevents blind retries
      this.stopDeviceMonitor();
    }finally{this.deviceBusy.set(false);}
  }
  exportMapping():void{
    try{
      const safe=validateModbusConfig(this.mappingDraft());
      const blob=new Blob([JSON.stringify(safe,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const link=document.createElement('a');
      link.href=url;link.download='modbus-device.json';link.click();
      URL.revokeObjectURL(url);
      this.mappingStatus.set('Valid Modbus mapping exported · load it on Node server');
    }catch(error){this.mappingStatus.set('Export blocked: '+String(error));}
  }
  async importMapping(event:Event):Promise<void>{
    const input=event.target as HTMLInputElement;
    const file=input.files?.[0];input.value='';
    if(!file)return;
    try{
      if(file.size>MAX_MAPPING_BYTES)throw Error('Maximum Modbus file size 128 KiB');
      const safe=validateModbusConfig(JSON.parse(await file.text()) as ModbusConfig);
      this.applyMapping(safe);
      this.mappingStatus.set('Modbus mapping validated and imported');
    }catch(error){this.mappingStatus.set('Import rejected: '+String(error));}
  }

  readonly palette:{kind:ShapeKind;label:string;glyph:string}[]=[
    {kind:'rect',label:'Rectangle',glyph:'▭'},
    {kind:'ellipse',label:'Ellipse',glyph:'◯'},
    {kind:'line',label:'Line',glyph:'╱'},
    {kind:'text',label:'Text',glyph:'T'},
    {kind:'breaker',label:'Breaker symbol',glyph:'⊠'}
  ];
  private past:Project[]=[];
  private future:Project[]=[];
  private drag:Drag|null=null;
  private readonly tagStream=new TagStreamClient({
    onStatus:status=>this.serverStatus.set(status),
    onSource:source=>this.serverKind.set(source),
    onReset:()=>{
      this.serverSamples.set(new Map());
      this.freshnessClock.set(Date.now());
      this.rescheduleFreshness();
    },
    onSample:(sample,time)=>{
      const previous=this.serverSamples();
      this.serverSamples.set(updateTagSample(previous,{...sample,receivedAtMs:time}));
      this.freshnessClock.set(time);
      this.rescheduleFreshness();
    }
  });
  private readonly streamSync=effect(()=>{
    const active=this.previewMode()&&this.previewSource()==='server';
    const tags=this.boundTags();
    if(active){this.tagStream.setTags(tags);this.tagStream.start();}
    else this.tagStream.stop();
  });
  ngOnDestroy():void{
    this.stopTrendTimer();
    this.stopAlarmTimer();
    this.stopDeviceMonitor();
    this.tagStream.stop();
    this.cancelFreshnessTimer();
  }
  private cancelFreshnessTimer():void{
    if(this.freshnessTimer!==null)clearTimeout(this.freshnessTimer);
    this.freshnessTimer=null;
  }
  private rescheduleFreshness():void {
    this.cancelFreshnessTimer();
    if(!this.previewMode())return;
    const now=Date.now();
    const deadline=nextFreshnessDeadline(this.activeSamples(),now);
    if(deadline===null)return;
    this.freshnessTimer=setTimeout(()=>{
      this.freshnessTimer=null;
      this.freshnessClock.set(Date.now());
      this.rescheduleFreshness();
    },Math.max(1,deadline-now+1));
  }

  private restore():Project {
    try {
      const raw=localStorage.getItem(STORAGE_KEY);
      return raw?parseProject(JSON.parse(raw)):initialProject();
    } catch { return initialProject(); }
  }
  private persist():void {
    try {
      localStorage.setItem(STORAGE_KEY,JSON.stringify(this.project()));
      this.status.set('Saved to this browser');
    } catch {
      this.status.set('Local save failed · export JSON to keep changes');
    }
  }
  private record(next:Project):void {
    if (JSON.stringify(next)===JSON.stringify(this.project())) return;
    this.past.push(this.project());
    if (this.past.length>60) this.past.shift();
    this.future=[];
    this.project.set(next);
    this.pruneSelection();
    this.canUndo.set(true);
    this.canRedo.set(false);
    this.persist();
  }
  undo():void {
    const previous=this.past.pop();
    if (!previous) return;
    this.future.push(this.project());
    this.project.set(previous);
    this.pruneSelection();
    this.canUndo.set(this.past.length>0);
    this.canRedo.set(true);
    this.persist();
  }
  redo():void {
    const next=this.future.pop();
    if (!next) return;
    this.past.push(this.project());
    this.project.set(next);
    this.canUndo.set(true);
    this.canRedo.set(this.future.length>0);
    this.persist();
  }
  add(kind:ShapeKind):void {
    try {
      const shape=newShape(kind,this.activePage().shapes.length);
      this.record(insertShape(this.project(),shape));
      this.selectOnly(shape.id);
    } catch(error) { this.status.set(String(error)); }
  }


  /** Selection is UI-only, not written into the versioned project. */
  selectOnly(id:string|null):void{this.selectedIds.set(id?[id]:[]);}
  selectFromEvent(id:string,e:MouseEvent|PointerEvent):void{
    if(this.previewMode())return;
    if(e.shiftKey||e.ctrlKey||e.metaKey){
      this.selectedIds.update(ids=>ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);
    }else if(!this.selectedIds().includes(id)||this.selectedIds().length!==1){
      this.selectOnly(id);
    }
  }
  selectAll():void{
    if(!this.previewMode())this.selectedIds.set(this.activePage().shapes.map(s=>s.id));
  }
  alignSelection(mode:Align):void{
    if(this.previewMode()||this.selectionCount()<2)return;
    try{
      this.record(alignObjects(this.project(),this.selectedIds(),mode));
      this.status.set('Aligned '+this.selectionCount()+' objects');
    }catch(error){this.status.set(String(error));}
  }
  distributeSelection(axis:Axis):void{
    if(this.previewMode()||this.selectionCount()<3)return;
    try{
      this.record(distributeObjects(this.project(),this.selectedIds(),axis));
      this.status.set('Distributed '+this.selectionCount()+' objects');
    }catch(error){this.status.set(String(error));}
  }
  private pruneSelection():void{
    const valid=new Set(this.activePage().shapes.map(s=>s.id));
    this.selectedIds.update(ids=>ids.filter(id=>valid.has(id)));
  }

  /** Quick actions keep the operator flow in one workspace. */
  duplicateSelected():void {
    const id=this.selectedId();
    if(!id || this.previewMode()) return;
    try {
      const next=duplicateShape(this.project(),id);
      this.record(next.project);
      this.selectOnly(next.newId);
      this.status.set('Object duplicated · click to move it');
    } catch(error) { this.status.set(String(error)); }
  }
  layerOrder(direction:'front'|'back'):void {
    const id=this.selectedId();
    if(!id || this.previewMode()) return;
    this.record(reorderShape(this.project(),id,direction));
  }
  updateProjectName(event:Event):void {
    const input=event.target as HTMLInputElement;
    try{this.record(renameProject(this.project(),input.value));}
    catch(error){this.status.set(String(error));input.value=this.project().name;}
  }
  updatePageName(event:Event):void {
    const input=event.target as HTMLInputElement;
    try{this.record(renamePage(this.project(),this.project().activePageId,input.value));}
    catch(error){this.status.set(String(error));input.value=this.activePage().name;}
  }
  removePage():void {
    try{
      this.record(deletePage(this.project(),this.project().activePageId));
      this.selectOnly(null);
      this.status.set('Page removed · Undo can restore it');
    }catch(error){this.status.set(String(error));}
  }
  startPaletteDrag(event:DragEvent,kind:ShapeKind):void {
    event.dataTransfer?.setData('application/x-web-hmi-shape',kind);
    if(event.dataTransfer) event.dataTransfer.effectAllowed='copy';
  }
  allowPaletteDrop(event:DragEvent):void {
    if(event.dataTransfer?.types.includes('application/x-web-hmi-shape') ||
      event.dataTransfer?.types.includes('application/x-web-hmi-symbol') ||
      event.dataTransfer?.types.includes('application/x-web-hmi-custom-symbol')){
      event.preventDefault();
      event.dataTransfer.dropEffect='copy';
    }
  }
  dropPaletteShape(event:DragEvent):void {
    const kind=event.dataTransfer?.getData('application/x-web-hmi-shape');
    const symbolId=event.dataTransfer?.getData('application/x-web-hmi-symbol');
    const customId=event.dataTransfer?.getData('application/x-web-hmi-custom-symbol');
    if(this.previewMode())return;
    if(!symbolId&&!customId && (!kind||!this.palette.some(tool=>tool.kind===kind)))return;
    if(symbolId && !findSymbol(symbolId))return;
    if(customId && !findDynamicSymbol(customId,this.project().customSymbols??[]) &&
      !this.vectorCatalog().has(customId))return;
    event.preventDefault();
    const point=this.pointerToCanvas(event);
    if(!point)return;
    if(customId){
      try{
        if(this.vectorCatalog().has(customId))this.placeVectorSymbol(customId,
          this.round(point.x-45),this.round(point.y-45));
        else this.placeCustomSymbol(customId,this.round(point.x-45),this.round(point.y-45));
      catch(error){this.status.set(String(error));}
      return;
    }
    const shape=symbolId?newSymbol(symbolId,this.activePage().shapes.length):
      newShape(kind as ShapeKind,this.activePage().shapes.length);
    const placed={...shape,
      x:this.round(Math.max(0,Math.min(1200-shape.width,point.x-shape.width/2))),
      y:this.round(Math.max(0,Math.min(700-shape.height,point.y-shape.height/2)))};
    try{
      this.record(insertShape(this.project(),placed));
      this.selectOnly(shape.id);
      this.status.set('Object placed · drag to reposition or edit properties');
    }catch(error){this.status.set(String(error));}
  }

  stateOf(shape:Shape):VisualState|undefined{return this.visualStates().get(shape.id);}
  vectorSymbol(shape:Shape):VectorSymbol|undefined{
    return shape.kind==='symbol'?this.vectorCatalog().get(shape.symbolId??''):undefined;
  }
  vectorAppearance(shape:Shape):RenderVectorSymbol|undefined{
    return this.vectorFrames().get(shape.id);
  }
  openVectorStudio(shape?:Shape):void{
    if(this.previewMode())return;
    this.studioSource.set(shape?this.vectorSymbol(shape)??null:null);
    this.symbolStudioOpen.set(true);
  }
  saveVectorToLibrary(raw:VectorSymbol):void{
    if(this.previewMode())return;
    try{
      // Full bounded validation also protects project export/import.
      const serialized=JSON.stringify(raw);
      if(serialized.length>131072)throw Error('Symbol exceeds 128 KiB');
      const def=parseVectorSymbolJson(serialized);
      if(!vectorSymbolIdAllowed(def.id)||!!findDynamicSymbol(def.id)||
        !!findSymbol(def.id)||(this.project().customSymbols??[]).some(s=>s.id===def.id))
        throw Error('Reserved or conflicting Symbol ID');
      const catalog=this.project().vectorSymbols??[];
      const existing=catalog.findIndex(s=>s.id===def.id);
      if(existing<0&&catalog.length>=128)throw Error('Maximum 128 V2 symbols');
      const next=existing<0?[...catalog,def]:
        catalog.map(s=>s.id===def.id?def:s);
      this.record({...this.project(),vectorSymbols:next});
      this.status.set(def.name+' saved in HMI Library · ready to drag and bind');
    }catch(error){this.status.set('Symbol save rejected: '+String(error));}
  }
  private placeVectorSymbol(id:string,x?:number,y?:number):void{
    const def=this.vectorCatalog().get(id);
    if(!def)throw Error('Unknown Vector Symbol');
    const shape=newVectorInstance(def,this.activePage().shapes.length);
    const placed={...shape,
      ...(x===undefined?{}:{x:Math.max(0,Math.min(1200-shape.width,x))}),
      ...(y===undefined?{}:{y:Math.max(0,Math.min(700-shape.height,y))})};
    this.record(insertShape(this.project(),placed));
    this.selectOnly(placed.id);
  }
  addVectorSymbol(id:string):void{
    if(this.previewMode())return;
    try{this.placeVectorSymbol(id);
      this.status.set('Vector symbol placed · bind a tag in the Inspector');
    }catch(error){this.status.set(String(error));}
  }
  startVectorDrag(event:DragEvent,id:string):void{
    if(this.previewMode()||!this.vectorCatalog().has(id))return;
    event.dataTransfer?.setData('application/x-web-hmi-custom-symbol',id);
    if(event.dataTransfer)event.dataTransfer.effectAllowed='copy';
  }
  editVectorSymbol(shape:Shape):void{
    if(this.vectorSymbol(shape))this.openVectorStudio(shape);
  }
  exportVectorSymbol(shape:Shape):void{
    const def=this.vectorSymbol(shape);
    if(def)this.downloadJson(def,def.id+'.symbol.json');
  }
  dynamicSymbol(shape:Shape):DynamicSymbol|undefined{
    return shape.kind==='symbol'?
      this.dynamicCatalog().get(shape.symbolId??''):undefined;
  }
  dynamicState(shape:Shape):DynamicAppearance|undefined{
    return this.dynamicStates().get(shape.id);
  }
  setPointMode(shape:Shape,event:Event):void {
    const value=(event.target as HTMLSelectElement).value;
    if(value!=='single-point'&&value!=='double-point')return;
    try{this.record(editShape(this.project(),shape.id,{pointMode:value as PointMode}));}
    catch(error){this.status.set(String(error));}
  }
  private placeCustomSymbol(id:string,x?:number,y?:number):void{
    const def=findDynamicSymbol(id,this.project().customSymbols??[]);
    if(!def)return;
    const shape:Shape={...newShape('rect',this.activePage().shapes.length),
      kind:'symbol',symbolId:id,name:def.name,pointMode:'double-point',
      width:Math.max(40,Math.min(140,def.viewBox[0])),
      height:Math.max(40,Math.min(140,def.viewBox[1])),animation:'none'};
    const next={...shape,...(x===undefined?{}:{x}),...(y===undefined?{}:{y})};
    this.record(insertShape(this.project(),next));
    this.selectOnly(next.id);
  }
  addCustomSymbol(id:string):void {
    if(this.previewMode())return;
    try{this.placeCustomSymbol(id);this.status.set('Reusable symbol inserted · bind a tag');}
    catch(error){this.status.set(String(error));}
  }
  startCustomSymbolDrag(event:DragEvent,id:string):void{
    if(this.previewMode()||!findDynamicSymbol(id,this.project().customSymbols??[]))return;
    event.dataTransfer?.setData('application/x-web-hmi-custom-symbol',id);
    if(event.dataTransfer)event.dataTransfer.effectAllowed='copy';
  }
  private downloadJson(value:unknown,name:string):void{
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],
      {type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=name;a.click();
    URL.revokeObjectURL(url);
  }
  exportDynamicSymbol(shape:Shape):void{
    const def=this.dynamicSymbol(shape);
    if(!def)return;
    this.downloadJson(def,def.id+'.symbol.json');
    this.status.set('Portable dynamic symbol exported');
  }
  async importDynamicSymbol(event:Event):Promise<void>{
    const input=event.target as HTMLInputElement;
    const file=input.files?.[0];input.value='';
    if(!file)return;
    try{
      if(file.size>128_000)throw Error('Maximum symbol file size is 128 KB');
      const parsed=JSON.parse(await file.text()) as unknown;
      if(parsed&&typeof parsed==='object'&&
        (parsed as {format?:unknown}).format==='web-hmi-vector-symbol'){
        const def=parseVectorSymbolJson(JSON.stringify(parsed));
        this.saveVectorToLibrary(def);
        return;
      }
      const def=parseDynamicSymbol(parsed);
      if(!!findDynamicSymbol(def.id)||!!findSymbol(def.id)||
        this.vectorCatalog().has(def.id))throw Error('Reserved symbol ID');
      const custom=this.project().customSymbols??[];
      if(custom.some(x=>x.id===def.id))throw Error('Symbol already exists: '+def.id);
      if(custom.length>=128)throw Error('Maximum 128 custom symbols');
      this.record({...this.project(),customSymbols:[...custom,def]});
      this.status.set('Dynamic symbol imported to project library: '+def.name);
    }catch(error){this.status.set('Symbol import rejected: '+String(error));}
  }
  openSymbolBuilder():void{
    if(this.previewMode()||!this.symbolBuilderPossible())return;
    const moving=this.symbolBuilderLines().at(-1)!;
    this.symbolBuilderMoving.set(moving.id);
    this.symbolBuilderPivotX.set(moving.x);
    this.symbolBuilderPivotY.set(moving.y);
    this.symbolBuilderName.set('My Circuit Breaker');
    this.symbolBuilderOpenAngle.set(-60);
    this.symbolBuilderOpen.set(true);
  }
  chooseMovingBlade(event:Event):void{
    const id=(event.target as HTMLSelectElement).value;
    const line=this.symbolBuilderLines().find(l=>l.id===id);
    if(!line)return;
    this.symbolBuilderMoving.set(id);
    this.symbolBuilderPivotX.set(line.x);
    this.symbolBuilderPivotY.set(line.y);
  }
  saveComposedSymbol():void{
    if(!this.symbolBuilderPossible())return;
    try{
      const name=this.symbolBuilderName().trim();
      const def=composeLineSymbol(this.symbolBuilderLines(),name,
        this.symbolBuilderMoving(),[this.symbolBuilderPivotX(),this.symbolBuilderPivotY()],
        this.symbolBuilderOpenAngle());
      const custom=this.project().customSymbols??[];
      if(custom.length>=128)throw Error('Maximum 128 custom symbols');
      if(this.vectorCatalog().has(def.id))throw Error('Duplicate custom symbol ID');
      this.record({...this.project(),customSymbols:[...custom,def]});
      this.symbolBuilderOpen.set(false);
      this.status.set('Reusable '+name+' saved · available in My Symbols');
    }catch(error){this.status.set('Symbol creation failed: '+String(error));}
  }
  symbolAnimated(shape:Shape):boolean{return this.stateOf(shape)?.animate??false;}
  partAppearance(shape:Shape,index:number):PartAppearance{
    return this.partAppearances().get(shape.id)?.[index] ??
      {stroke:shape.stroke,visible:true,spin:false};
  }
  partEffect(shape:Shape,index:number):string{
    return shape.partRules?.find(rule=>rule.partIndex===index)?.effect??'default';
  }
  updatePartEffect(shape:Shape,index:number,event:Event):void{
    const value=(event.target as HTMLSelectElement).value;
    const allowed=['default','fixed','state-color','hide-idle','spin-active'];
    const graphic=findProcessGraphic(shape.symbolId);
    if(!graphic||!allowed.includes(value)||index<0||index>=graphic.parts.length)return;
    const rules=(shape.partRules??[]).filter(rule=>rule.partIndex!==index);
    if(value!=='default')
      rules.push({partIndex:index,effect:value as PartEffect});
    rules.sort((a,b)=>a.partIndex-b.partIndex);
    try{this.record(editShape(this.project(),shape.id,{partRules:rules}));}
    catch(error){this.status.set(String(error));}
  }
  partStroke(shape:Shape,rotor:boolean):string{
    const state=this.stateOf(shape);
    if(!state || !shape.tagId || !this.previewMode())return shape.stroke;
    if(state.warning)return state.stroke;
    return rotor?state.stroke:shape.stroke;
  }
  changeSimulatedTag(event:Event):void{
    this.simulatedTagChoice.set((event.target as HTMLSelectElement).value);
  }
  changeSimulatedQuality(event:Event):void{
    const quality=(event.target as HTMLSelectElement).value as TagQuality;
    if(!(['GOOD','UNCERTAIN','BAD','STALE'] as string[]).includes(quality))return;
    this.simulatedQuality.set(quality);
    this.publishSimulation(this.simulatedValue());
  }
  simulateNumber(event:Event):void{
    const value=Number((event.target as HTMLInputElement).value);
    if(Number.isFinite(value))this.simulateValue(value);
  }
  simulateValue(value:number):void{
    this.simulatedValue.set(value);
    this.publishSimulation(value);
  }
  private publishSimulation(value:number):void{
    if(this.previewSource()!=='local')return;
    const tagId=this.simulatedTag();
    if(!tagId)return;
    const previous=this.simulatedSamples();
    const sequence=(previous.get(tagId)?.sequence??0)+1;
    try{
      const now=Date.now();
      this.simulatedSamples.set(updateTagSample(previous,{
        tagId,value,quality:this.simulatedQuality(),sequence,receivedAtMs:now
      }));
      this.freshnessClock.set(now);
      this.rescheduleFreshness();
    }catch(error){this.status.set(String(error));}
  }
  symbolUrl(shape:Shape):string{
    return findSymbol(shape.symbolId??'')?.href??'';
  }
  searchSymbol(event:Event):void{
    this.symbolSearch.set((event.target as HTMLInputElement).value);
    this.symbolLimit.set(24);
  }
  chooseSymbolCategory(event:Event):void{
    const category=(event.target as HTMLSelectElement).value;
    if(this.symbolCategories.some(item=>item===category))
      this.symbolCategory.set(category as SymbolCategory);
    this.symbolLimit.set(24);
  }
  addSymbol(symbolId:string):void{
    if(this.previewMode())return;
    try{
      const symbol=newSymbol(symbolId,this.activePage().shapes.length);
      this.record(insertShape(this.project(),symbol));
      this.selectOnly(symbol.id);
      this.status.set('SVG symbol added · resize, bind a tag, or enable preview animation');
    }catch(error){this.status.set(String(error));}
  }
  startSymbolDrag(event:DragEvent,symbolId:string):void{
    if(this.previewMode())return;
    if(!findSymbol(symbolId))return;
    event.dataTransfer?.setData('application/x-web-hmi-symbol',symbolId);
    if(event.dataTransfer)event.dataTransfer.effectAllowed='copy';
  }
  removeSelected():void{
    if(!this.selectionCount()||this.previewMode())return;
    this.record(deleteObjects(this.project(),this.selectedIds()));
    this.selectOnly(null);
  }
  addPage():void {
    try {
      this.record(createPage(this.project()));
      this.selectOnly(null);
    } catch(error) { this.status.set(String(error)); }
  }
  selectPage(id:string):void {
    if (!this.project().pages.some(p=>p.id===id)) return;
    this.record({...this.project(),activePageId:id});
    this.selectOnly(null);
  }
  toggleGrid():void { this.gridVisible.update(v=>!v); }
  toggleSnap():void { this.snapEnabled.update(v=>!v); }
  choosePreviewSource(event:Event):void{
    const value=(event.target as HTMLSelectElement).value;
    if(value==='local'||value==='server'){
      this.previewSource.set(value);
      this.freshnessClock.set(Date.now());
      this.rescheduleFreshness();
    }
  }
  togglePreview():void {
    if(this.alarmOpen())this.toggleAlarmCenter();
    if(this.trendOpen())this.toggleTrends();
    if(this.mappingOpen())this.mappingOpen.set(false);
    if(this.symbolBuilderOpen())this.symbolBuilderOpen.set(false);
    this.previewMode.update(v=>!v);
    this.selectOnly(null);
    this.freshnessClock.set(Date.now());
    this.rescheduleFreshness();
  }
  zoomBy(delta:number):void {
    this.zoom.update(value=>Math.min(2.5,Math.max(0.5,Math.round((value+delta)*10)/10)));
  }
  displayX(s:Shape):number {
    const offset=this.dragOffsets()[s.id];
    if(offset)return offset.x;
    const p=this.preview();
    return p?.id===s.id?p.x:s.x;
  }
  displayY(s:Shape):number {
    const offset=this.dragOffsets()[s.id];
    if(offset)return offset.y;
    const p=this.preview();
    return p?.id===s.id?p.y:s.y;
  }
  displayWidth(s:Shape):number {
    const p=this.preview();
    return p?.id===s.id?p.width:s.width;
  }
  displayHeight(s:Shape):number {
    const p=this.preview();
    return p?.id===s.id?p.height:s.height;
  }
  onCanvasDown():void {
    if(!this.previewMode())this.selectOnly(null);
  }
  private pointerToCanvas(e:Pick<PointerEvent,'clientX'|'clientY'>):{x:number;y:number}|null {
    const svg=this.viewport?.nativeElement;
    const ctm=svg?.getScreenCTM();
    if (!ctm) return null;
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(ctm.inverse());
    return {x:p.x,y:p.y};
  }
  beginDrag(e:PointerEvent,s:Shape):void{
    if(e.button!==0||this.previewMode())return;
    e.stopPropagation();
    if(e.shiftKey||e.ctrlKey||e.metaKey){
      this.selectFromEvent(s.id,e);return;
    }
    if(!this.selectedIds().includes(s.id))this.selectOnly(s.id);
    const point=this.pointerToCanvas(e);
    if(!point)return;
    const ids=new Set(this.selectedIds());
    const members=this.activePage().shapes.filter(shape=>ids.has(shape.id));
    this.drag={id:s.id,pointerId:e.pointerId,startX:point.x,startY:point.y,
      original:s,members,mode:'move'};
    this.viewport?.nativeElement.setPointerCapture(e.pointerId);
  }
  beginResize(e:PointerEvent,s:Shape):void {
    if(e.button!==0 || this.previewMode() || s.kind==='text')return;
    e.stopPropagation();
    this.selectOnly(s.id);
    const p=this.pointerToCanvas(e);
    if(!p)return;
    this.drag={id:s.id,pointerId:e.pointerId,startX:p.x,startY:p.y,
      original:s,members:[s],mode:'resize'};
    this.viewport?.nativeElement.setPointerCapture(e.pointerId);
  }
  movePointer(e:PointerEvent):void {
    const d=this.drag;
    if (!d || d.pointerId!==e.pointerId) return;
    const p=this.pointerToCanvas(e);
    if (!p) return;
    const dx=p.x-d.startX,dy=p.y-d.startY;
    if(d.mode==='resize'){
      this.preview.set({id:d.id,x:d.original.x,y:d.original.y,
        width:Math.max(1,Math.min(10000,this.round(d.original.width+dx))),
        height:Math.max(1,Math.min(10000,this.round(d.original.height+dy)))});
    }else{
      const offsetX=this.round(d.original.x+dx)-d.original.x;
      const offsetY=this.round(d.original.y+dy)-d.original.y;
      const offsets:Record<string,{x:number;y:number}>={};
      for(const member of d.members){
        offsets[member.id]={
          x:Math.max(-10000,Math.min(10000,member.x+offsetX)),
          y:Math.max(-10000,Math.min(10000,member.y+offsetY))
        };
      }
      this.dragOffsets.set(offsets);
    }
  }
  endPointer(e:PointerEvent):void {
    const d=this.drag;
    if (!d || d.pointerId!==e.pointerId) return;
    const preview=this.preview(),moved=this.dragOffsets()[d.id];
    this.drag=null;this.preview.set(null);this.dragOffsets.set({});
    const svg=this.viewport?.nativeElement;
    if(svg?.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);
    try{
      if(d.mode==='resize'&&preview?.id===d.id){
        this.record(editShape(this.project(),d.id,
          {width:preview.width,height:preview.height}));
      }else if(d.mode==='move'&&moved){
        this.record(moveObjects(this.project(),d.members.map(s=>s.id),
          moved.x-d.original.x,moved.y-d.original.y));
      }
    }catch(error){this.status.set(String(error));}
  }
  cancelPointer(e:PointerEvent):void {
    if(!this.drag || this.drag.pointerId!==e.pointerId)return;
    this.drag=null;
    this.preview.set(null);
    this.dragOffsets.set({});
    const svg=this.viewport?.nativeElement;
    if(svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
  }
  private round(n:number):number {
    return this.snapEnabled()?Math.round(n/10)*10:Math.round(n);
  }
  updateProperty(key:keyof ShapeEdit,e:Event):void {
    const selected=this.selected();
    if (!selected) return;
    const target=e.target as HTMLInputElement;
    const value=['x','y','width','height','threshold'].includes(key)?
      Number(target.value):target.value;
    try { this.record(editShape(this.project(),selected.id,{[key]:value} as ShapeEdit)); }
    catch(error) { this.status.set(String(error));target.value=String(selected[key]); }
  }
  exportProject():void {
    const blob=new Blob([JSON.stringify(this.project(),null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download='web-hmi-project.json';
    anchor.click();URL.revokeObjectURL(url);
    this.status.set('JSON project exported');
  }
  async importProject(e:Event):Promise<void> {
    const input=e.target as HTMLInputElement;
    const file=input.files?.[0];
    input.value='';
    if (!file) return;
    try {
      if (file.size>2_000_000) throw new Error('Project exceeds 2 MB import limit');
      const imported=parseProject(JSON.parse(await file.text()));
      this.record(imported);
      this.selectOnly(null);
      this.status.set('Validated project imported');
    } catch(error) { this.status.set('Import rejected: '+String(error)); }
  }
  @HostListener('window:keydown',['$event'])
  shortcut(e:KeyboardEvent):void {
    // Symbol Studio owns keyboard focus, Undo/Redo and Delete while open.
    if(this.symbolStudioOpen())return;
    const node=e.target as HTMLElement|null;
    if (node?.closest('input,textarea,[contenteditable="true"]')) return;
    const modifier=e.ctrlKey||e.metaKey;
    if(e.key==='Escape'){this.selectOnly(null);return;}
    if(modifier&&e.key.toLowerCase()==='a'&&!this.previewMode()){
      e.preventDefault();this.selectAll();return;
    }
    if(modifier && e.key.toLowerCase()==='d' && this.selectedId() && !this.previewMode()){
      e.preventDefault();this.duplicateSelected();return;
    }
    if (modifier && e.key.toLowerCase()==='z') {
      e.preventDefault();e.shiftKey?this.redo():this.undo();return;
    }
    if (modifier && e.key.toLowerCase()==='y') {
      e.preventDefault();this.redo();return;
    }
    if (e.key==='Delete'||e.key==='Backspace') {
      if(this.selectionCount()){e.preventDefault();this.removeSelected();}
      return;
    }
    const step=e.shiftKey?10:1;
    const arrows:Record<string,[number,number]>={
      ArrowLeft:[-step,0],ArrowRight:[step,0],
      ArrowUp:[0,-step],ArrowDown:[0,step]
    };
    const move=arrows[e.key];
    if(move&&this.selectionCount()&&!this.previewMode()){
      e.preventDefault();
      try{this.record(moveObjects(this.project(),this.selectedIds(),move[0]!,move[1]!));}
      catch(error){this.status.set(String(error));}
    }
  }
}
