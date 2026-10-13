import {ChangeDetectionStrategy,Component,ElementRef,HostListener,ViewChild,
  computed,output,input,effect,signal} from '@angular/core';
import {CB_ROTATING} from './dynamic-symbol.ts';
import {migrateDynamicSymbolV1,parseVectorSymbolJson,parseVectorSymbol,
  indexVectorNodes,type VectorSymbol,type VectorNode,type Vector2,type VectorStyle,
  type VectorTransform,type NodeOverride,type VectorState} from './symbol-studio-model.ts';
import {SymbolEditHistory,type SymbolEdit} from './symbol-studio-commands.ts';
import {IDENTITY,product,transformMatrix,applyAffine,boundingHandles,
  dragEndpointFromWorld,moveNodeFromWorld,resizeRectFromWorld,
  resizeEllipseFromWorld,rotateAroundPivot,worldToNode,type Affine,type EdgeHandle} from './symbol-studio-geometry.ts';
import {nodeLocations} from './symbol-studio-grouping.ts';

type Tool='select'|'line'|'rect'|'ellipse';
type Handle='start'|'end'|EdgeHandle|'rotate';
type Gesture={id:string;pointerId:number;start:Vector2;source:VectorSymbol;handle:Handle|'move'};
type Paint=VectorStyle;
type Row={id:string;node:VectorNode;level:number;matrix:Affine;
  paint:Paint|null;visible:boolean;rotation:number;label:string};
const STORAGE='web-hmi.symbol-studio.v2';
const STYLE:Paint={fill:'none',stroke:'#8dbece',strokeWidth:3,opacity:1};
const TRANSFORM:VectorTransform={x:0,y:0,rotation:0,scaleX:1,scaleY:1,pivot:[0,0]};
function starter():VectorSymbol{
  const v1=migrateDynamicSymbolV1(CB_ROTATING);
  return parseVectorSymbol({...v1,id:'user-cb-starter',name:'My Circuit Breaker'});
}
function restored():VectorSymbol{
  try{
    const text=localStorage.getItem(STORAGE);
    if(text&&text.length<=131072)return parseVectorSymbolJson(text);
  }catch{/* Ignore stale or inaccessible browser-only draft. */}
  return starter();
}
function randomId(prefix:string):string{
  return prefix+'-'+crypto.randomUUID().replaceAll('-','').slice(0,14);
}
function clampNumber(n:number,min:number,max:number):number{
  return Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;
}
function effective(node:VectorNode,state:VectorState|null):{
  visible:boolean;transform:VectorTransform;style:Paint|null;text:string|undefined
}{
  const ov=state?.overrides[node.id];
  return {visible:ov?.visible??node.visible,
    transform:{...node.transform,...ov?.transform},
    style:node.kind==='group'?null:{...node.style,...ov?.style},
    text:node.kind==='text'?ov?.text??node.text:undefined};
}
@Component({
  selector:'hmi-symbol-studio',standalone:true,imports:[],
  templateUrl:'./symbol-studio.component.html',
  styleUrl:'./symbol-studio.component.css',
  changeDetection:ChangeDetectionStrategy.OnPush
})
export class SymbolStudioComponent {
  readonly closed=output<void>();
  readonly savedToLibrary=output<VectorSymbol>();
  readonly definition=input<VectorSymbol|null>(null);
  private loadedDefinition:string|null=null;
  constructor(){
    effect(()=>{
      const incoming=this.definition();
      // Avoid clobbering unsaved edits on unrelated parent UI updates.
      if(incoming&&this.loadedDefinition!==JSON.stringify(incoming)){
        this.loadedDefinition=JSON.stringify(incoming);
        this.history=new SymbolEditHistory(parseVectorSymbol(incoming));
        this.model.set(this.history.document);
        // Open an existing symbol with a drawable child selected so the
        // property Inspector is immediately usable, including nested groups.
        const first=[...indexVectorNodes(this.history.document).values()]
          .find(node=>node.kind!=='group');
        this.selectedId.set(first?.id??null);
        this.selectedIds.set(first?[first.id]:[]);
        this.isolatedGroup.set(null);
        this.activeState.set('BASE');
        this.canUndo.set(false);this.canRedo.set(false);this.dirty.set(false);
      }
    });
  }
  @ViewChild('artboard') artboard?:ElementRef<SVGSVGElement>;
  private history=new SymbolEditHistory(restored());
  readonly model=signal<VectorSymbol>(this.history.document);
  readonly selectedId=signal<string|null>(
    [...indexVectorNodes(this.history.document).values()].find(n=>n.kind!=='group')?.id??null);
  readonly selectedIds=signal<readonly string[]>(
    this.selectedId()?[this.selectedId()!]:[]);
  readonly activeState=signal<string>('BASE');
  readonly activeTool=signal<Tool>('select');
  readonly snapEnabled=signal(true);
  readonly status=signal('Symbol Studio · edits are local until Save');
  readonly context=signal<{x:number;y:number;id:string}|null>(null);
  readonly canUndo=signal(false);
  readonly canRedo=signal(false);
  readonly isolatedGroup=signal<string|null>(null);
  readonly canGroup=computed(()=>{
    const ids=this.selectedIds();
    if(ids.length<2)return false;
    const locations=nodeLocations(this.model());
    const parent=locations.get(ids[0]!)?.parentId;
    return ids.every(id=>locations.has(id)&&locations.get(id)!.parentId===parent);
  });
  readonly canUngroup=computed(()=>this.selected()?.kind==='group');
  readonly selected=computed(()=>indexVectorNodes(this.model()).get(this.selectedId()??'')??null);
  readonly selectedState=computed(()=>this.model().states.find(s=>s.id===this.activeState())??null);
  readonly appearance=computed(()=>this.selected()?effective(this.selected()!,this.selectedState()):null);
  readonly rows=computed(()=>{
    const state=this.selectedState(),rows:Row[]=[];
    const walk=(nodes:readonly VectorNode[],parent:Affine,level:number,visible:boolean)=>{
      for(const node of nodes){
        const view=effective(node,state);
        const matrix=product(parent,transformMatrix(view.transform));
        const active=visible&&view.visible;
        rows.push({id:node.id,node,level,matrix,paint:view.style,visible:active,
          rotation:view.transform.rotation,label:node.name});
        if(node.kind==='group')walk(node.children,matrix,level+1,active);
      }
    };
    walk(this.model().nodes,IDENTITY,0,true);
    return rows;
  });
  readonly selectedHandles=computed(()=>{
    if(this.activeTool()!=='select')return [] as {name:Handle;x:number;y:number}[];
    const row=this.rows().find(x=>x.id===this.selectedId());
    if(!row||row.node.kind==='group')return [];
    if(row.node.kind==='line'){
      return ([
        {name:'start' as Handle,point:applyAffine(row.matrix,[row.node.x1,row.node.y1])},
        {name:'end' as Handle,point:applyAffine(row.matrix,[row.node.x2,row.node.y2])}
      ]).map(h=>({name:h.name,x:h.point[0],y:h.point[1]}));
    }
    if(row.node.kind!=='rect'&&row.node.kind!=='ellipse')return [];
    const n=row.node;
    const b=n.kind==='rect'?
      {x:n.x,y:n.y,width:n.width,height:n.height}:
      {x:n.cx-n.rx,y:n.cy-n.ry,width:2*n.rx,height:2*n.ry};
    const points=boundingHandles(b,row.matrix);
    const list=(Object.entries(points) as [EdgeHandle,Vector2][])
      .map(([name,point])=>({name:name as Handle,x:point[0],y:point[1]}));
    const north=points.n;
    list.push({name:'rotate',x:north[0],y:north[1]-18});
    return list;
  });
  readonly visibleNodes=computed(()=>{
    const focus=this.isolatedGroup();
    const locations=nodeLocations(this.model());
    return this.rows().filter(row=>row.node.kind!=='group'&&row.visible&&
      (!focus||this.belongsToGroup(row.id,focus,locations)));
  });
  readonly layerRows=computed(()=>this.rows());
  readonly dirty=signal(false);
  private gesture:Gesture|null=null;
  private drawing:{pointerId:number;start:Vector2;current:Vector2}|null=null;
  readonly drawingPreview=signal<{start:Vector2;end:Vector2}|null>(null);
  readonly drawingBox=computed(()=>{
    const v=this.drawingPreview();
    return v?{x:Math.min(v.start[0],v.end[0]),y:Math.min(v.start[1],v.end[1]),
      width:Math.abs(v.end[0]-v.start[0]),height:Math.abs(v.end[1]-v.start[1])}:null;
  });

  setTool(tool:Tool):void{
    this.activeTool.set(tool);
    if(tool!=='select')this.activeState.set('BASE');
    this.context.set(null);
  }
  setState(id:string):void{
    if(id==='BASE'||this.model().states.some(s=>s.id===id))this.activeState.set(id);
    this.context.set(null);
  }
  private belongsToGroup(id:string,groupId:string,
    locations:ReturnType<typeof nodeLocations>):boolean{
    for(let at=locations.get(id)?.parentId;at!==undefined&&at!==null;
      at=locations.get(at)?.parentId){
      if(at===groupId)return true;
    }
    return false;
  }
  /** Outside group isolation, clicking its artwork selects the group. */
  private focusTarget(id:string):string{
    const locations=nodeLocations(this.model()),focus=this.isolatedGroup();
    let current=id;
    while(true){
      const parent=locations.get(current)?.parentId;
      if(parent===undefined||parent===null||parent===focus)return current;
      current=parent;
    }
  }
  choose(id:string,event?:MouseEvent|PointerEvent):void{
    const target=this.focusTarget(id);
    if(event&&(event.shiftKey||event.ctrlKey||event.metaKey)){
      const selected=this.selectedIds();
      const next=selected.includes(target)?selected.filter(x=>x!==target):
        [...selected,target];
      this.selectedIds.set(next);
      this.selectedId.set(next.at(-1)??null);
    }else{
      this.selectedIds.set([target]);this.selectedId.set(target);
    }
    this.context.set(null);
  }
  groupSelected():void{
    if(!this.canGroup()||this.gesture)return;
    const id=randomId('group');
    this.execute({type:'group',nodeIds:this.selectedIds(),groupId:id,name:'Group'});
    if(indexVectorNodes(this.model()).has(id)){
      this.selectedId.set(id);this.selectedIds.set([id]);
      this.status.set('Group created · double-click to edit children');
    }
    this.context.set(null);
  }
  ungroupSelected():void{
    const group=this.selected();
    if(group?.kind!=='group'||this.gesture)return;
    const children=group.children.map(x=>x.id);
    this.execute({type:'ungroup',groupId:group.id});
    if(!indexVectorNodes(this.model()).has(group.id)){
      if(this.isolatedGroup()===group.id)this.isolatedGroup.set(null);
      this.selectedIds.set(children);
      this.selectedId.set(children.at(-1)??null);
      this.status.set('Ungrouped · appearance and state overrides preserved');
    }
    this.context.set(null);
  }
  private refresh():void{
    this.model.set(this.history.document);
    const indexed=indexVectorNodes(this.history.document);
    const remaining=this.selectedIds().filter(id=>indexed.has(id));
    if(remaining.length!==this.selectedIds().length){
      this.selectedIds.set(remaining);
      this.selectedId.set(remaining.at(-1)??null);
    }
    if(this.isolatedGroup()&&!indexed.has(this.isolatedGroup()!))
      this.isolatedGroup.set(null);
    this.canUndo.set(this.history.canUndo);
    this.canRedo.set(this.history.canRedo);
    this.dirty.set(true);
  }
  private execute(edit:SymbolEdit):void{
    try{this.history.execute(edit);this.refresh();}
    catch(err){this.status.set(err instanceof Error?err.message:String(err));}
  }
  private point(event:PointerEvent):Vector2|null{
    const svg=this.artboard?.nativeElement,ctm=svg?.getScreenCTM();
    if(!svg||!ctm)return null;
    const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
    const out=p.matrixTransform(ctm.inverse());
    return [out.x,out.y];
  }
  private capture(event:PointerEvent):void{
    this.artboard?.nativeElement.setPointerCapture(event.pointerId);
    event.preventDefault();event.stopPropagation();
  }
  beginNode(event:PointerEvent,id:string):void{
    if(event.button!==0||this.activeTool()!=='select')return;
    const p=this.point(event);if(!p)return;
    this.choose(id,event);
    if(event.shiftKey||event.ctrlKey||event.metaKey){
      event.preventDefault();event.stopPropagation();return;
    }
    const target=this.selectedId()!;
    this.beginGesture(event,{id:target,pointerId:event.pointerId,start:p,
      source:this.model(),handle:'move'});
  }
  beginHandle(event:PointerEvent,handle:Handle):void{
    if(event.button!==0)return;
    const id=this.selectedId(),p=this.point(event);
    if(!id||!p)return;
    if(this.activeState()!=='BASE'&&handle!=='rotate'){
      this.status.set('Endpoint and size geometry belong to Base; switch to Base to edit.');
      return;
    }
    this.beginGesture(event,{id,pointerId:event.pointerId,start:p,
      source:this.model(),handle});
  }
  private beginGesture(event:PointerEvent,gesture:Gesture):void{
    this.gesture=gesture;
    this.history.beginGesture();
    this.capture(event);
  }
  beginArtboard(event:PointerEvent):void{
    if(event.button!==0)return;
    const p=this.point(event);if(!p)return;
    this.context.set(null);
    if(this.activeTool()==='select'){
      this.selectedId.set(null);this.selectedIds.set([]);return;
    }
    this.drawing={pointerId:event.pointerId,start:p,current:p};
    this.drawingPreview.set({start:p,end:p});
    this.capture(event);
  }
  movePointer(event:PointerEvent):void{
    const p=this.point(event);if(!p)return;
    if(this.drawing&&this.drawing.pointerId===event.pointerId){
      this.drawing.current=p;
      this.drawingPreview.set({start:this.drawing.start,end:p});return;
    }
    const drag=this.gesture;
    if(!drag||drag.pointerId!==event.pointerId)return;
    const n=indexVectorNodes(drag.source).get(drag.id);if(!n)return;
    const snap=this.snapEnabled()&&!event.altKey;
    const world=snap?[Math.round(p[0]/5)*5,Math.round(p[1]/5)*5] as Vector2:p;
    let edit:SymbolEdit;
    try{
      if(drag.handle==='start'||drag.handle==='end'){
        edit={type:'replace',node:dragEndpointFromWorld(drag.source,drag.id,drag.handle,world)};
      }else if(drag.handle==='rotate'){
        const transform=rotateAroundPivot(drag.source,drag.id,drag.start,p,event.shiftKey);
        edit=this.transformEdit(n,drag.id,transform,drag.handle,drag.source);
      }else if(drag.handle==='move'){
        const transform=moveNodeFromWorld(drag.source,drag.id,drag.start,world);
        edit=this.transformEdit(n,drag.id,transform,drag.handle,drag.source);
      }else if(n.kind==='rect'){
        edit={type:'replace',node:resizeRectFromWorld(drag.source,drag.id,drag.handle,world)};
      }else if(n.kind==='ellipse'){
        edit={type:'replace',node:resizeEllipseFromWorld(drag.source,drag.id,drag.handle,world)};
      }else return;
      this.history.previewGesture(edit);
      this.model.set(this.history.document);
    }catch(err){this.status.set(err instanceof Error?err.message:String(err));}
  }
  private transformEdit(node:VectorNode,id:string,transform:VectorTransform,
    handle:'move'|'rotate',source:VectorSymbol):SymbolEdit{
    const stateId=this.activeState();
    if(stateId==='BASE')return {type:'replace',node:{...node,transform}};
    // Only adjust the active property; preserve unrelated state overrides.
    const previous=source.states.find(x=>x.id===stateId)?.overrides[id]?.transform;
    const patch=handle==='rotate'?{
      rotation:(previous?.rotation??node.transform.rotation)+
        (transform.rotation-node.transform.rotation)
    }:{
      x:(previous?.x??node.transform.x)+(transform.x-node.transform.x),
      y:(previous?.y??node.transform.y)+(transform.y-node.transform.y)
    };
    return {type:'state-override',stateId,nodeId:id,patch:{transform:patch}};
  }
  endPointer(event:PointerEvent):void{
    if(this.drawing&&this.drawing.pointerId===event.pointerId){
      const d=this.drawing;this.drawing=null;this.drawingPreview.set(null);
      this.release(event);
      this.createFromGesture(d.start,d.current);
      return;
    }
    if(!this.gesture||this.gesture.pointerId!==event.pointerId)return;
    this.gesture=null;this.release(event);
    try{this.history.commitGesture();this.refresh();}
    catch(err){this.status.set(String(err));this.history.cancelGesture();}
  }
  cancelPointer(event:PointerEvent):void{
    if(this.gesture?.pointerId===event.pointerId){
      this.history.cancelGesture();this.gesture=null;this.model.set(this.history.document);
    }
    if(this.drawing?.pointerId===event.pointerId){
      this.drawing=null;this.drawingPreview.set(null);
    }
    this.release(event);
  }
  private release(event:PointerEvent):void{
    const svg=this.artboard?.nativeElement;
    if(svg?.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);
  }
  private createFromGesture(a:Vector2,b:Vector2):void{
    if(this.activeTool()==='select')return;
    const name=this.activeTool(),id=randomId(name);
    const focus=this.isolatedGroup();
    if(focus){
      a=worldToNode(this.model(),focus,a);
      b=worldToNode(this.model(),focus,b);
    }
    const common={id,name:name[0]!.toUpperCase()+name.slice(1),
      visible:true,transform:TRANSFORM,style:STYLE};
    const left=Math.min(a[0],b[0]),top=Math.min(a[1],b[1]);
    const w=Math.max(1,Math.abs(b[0]-a[0])),h=Math.max(1,Math.abs(b[1]-a[1]));
    let node:VectorNode;
    if(name==='line')node={...common,kind:'line',
      x1:a[0],y1:a[1],x2:b[0],y2:b[1]};
    else if(name==='rect')node={...common,kind:'rect',
      x:left,y:top,width:w,height:h,style:{...STYLE,fill:'#204353'}};
    else node={...common,kind:'ellipse',
      cx:left+w/2,cy:top+h/2,rx:w/2,ry:h/2,
      style:{...STYLE,fill:'#204353'}};
    this.execute({type:'insert',node,...(focus?{parentId:focus}:{})});
    this.selectedId.set(id);this.selectedIds.set([id]);this.activeTool.set('select');this.activeState.set('BASE');
    this.status.set('Created '+name+' · select handles to edit');
  }
  changeName(event:Event):void{
    const name=(event.target as HTMLInputElement).value.trim();
    if(!name||name.length>80)return;
    try{
      // Document metadata is an atomic edit outside geometry command stream.
      this.history=new SymbolEditHistory(parseVectorSymbol({...this.model(),name}));
      this.model.set(this.history.document);this.dirty.set(true);
      this.canUndo.set(false);this.canRedo.set(false);
    }catch(err){this.status.set(String(err));}
  }
  propertyColor(property:'fill'|'stroke',event:Event):void{
    const node=this.selected();if(!node||node.kind==='group')return;
    const color=(event.target as HTMLInputElement).value;
    this.propertyPatch({style:{[property]:color}});
  }
  propertyNumber(property:'rotation'|'opacity',event:Event):void{
    const raw=Number((event.target as HTMLInputElement).value);
    if(property==='rotation')this.propertyPatch({transform:{rotation:clampNumber(raw,-3600,3600)}});
    else this.propertyPatch({style:{opacity:clampNumber(raw,0,1)}});
  }
  toggleVisible(event:Event):void{
    this.propertyPatch({visible:(event.target as HTMLInputElement).checked});
  }
  private propertyPatch(patch:NodeOverride):void{
    const node=this.selected();if(!node)return;
    if(this.activeState()==='BASE'){
      const next={...node,
        ...(patch.visible!==undefined?{visible:patch.visible}:{}),
        ...(patch.style!==undefined&&node.kind!=='group'?{
          style:{...node.style,...patch.style}}:{}),
        ...(patch.transform!==undefined?{
          transform:{...node.transform,...patch.transform}}:{})};
      this.execute({type:'replace',node:next as VectorNode});
    }else{
      this.execute({type:'state-override',nodeId:node.id,
        stateId:this.activeState(),patch});
    }
  }
  resetStateProperty(field:'style.fill'|'style.stroke'|'transform.rotation'|'visible'):void{
    const id=this.selectedId();
    if(!id||this.activeState()==='BASE')return;
    this.execute({type:'reset-override',stateId:this.activeState(),nodeId:id,field});
  }
  undo():void{
    if(this.gesture)return;
    if(this.history.undo())this.refresh();
  }
  redo():void{
    if(this.gesture)return;
    if(this.history.redo())this.refresh();
  }
  deleteSelected():void{
    const id=this.selectedId();if(!id||this.gesture)return;
    this.execute({type:'remove',nodeId:id});
    if(!indexVectorNodes(this.model()).has(id)){
      this.selectedId.set(null);this.selectedIds.set([]);
    }
  }
  newSymbol():void{
    const base=starter();
    const first=base.nodes.find(node=>node.kind==='line')!;
    const blankLine={...first,id:'starter-line',name:'Starter line',
      x1:30,y1:50,x2:70,y2:50,style:{...STYLE}};
    const def=parseVectorSymbol({...base,id:randomId('user'),
      name:'Untitled Symbol',nodes:[blankLine],
      states:base.states.map(state=>({...state,overrides:{}}))});
    this.history=new SymbolEditHistory(def);this.model.set(def);
    this.selectedId.set('starter-line');this.selectedIds.set(['starter-line']);
    this.isolatedGroup.set(null);this.activeState.set('BASE');
    this.canUndo.set(false);this.canRedo.set(false);this.dirty.set(true);
    this.status.set('New symbol · edit elements and states, then Save');
  }
  save():void{
    try{
      const serialized=JSON.stringify(parseVectorSymbol(this.model()));
      if(serialized.length>131072)throw Error('Symbol is too large to save');
      localStorage.setItem(STORAGE,serialized);
      // Parent owns canonical project catalog and its Undo/Redo/history.
      this.savedToLibrary.emit(parseVectorSymbol(JSON.parse(serialized) as unknown));
      this.status.set('Saved to HMI Library and this browser · drag to canvas');
      this.dirty.set(false);
    }catch(err){this.status.set('Save failed: '+String(err));}
  }
  exportSymbol():void{
    try{
      const doc=parseVectorSymbol(this.model());
      const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download=doc.id+'.symbol.json';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),0);
      this.status.set('Symbol JSON exported');
    }catch(err){this.status.set('Export failed: '+String(err));}
  }
  async importSymbol(event:Event):Promise<void>{
    const input=event.target as HTMLInputElement,file=input.files?.[0];
    input.value='';if(!file)return;
    try{
      if(file.size>131072)throw Error('Maximum 128 KiB JSON import');
      const doc=parseVectorSymbolJson(await file.text());
      this.history=new SymbolEditHistory(doc);this.model.set(doc);
      this.canUndo.set(false);this.canRedo.set(false);
      this.selectedId.set(null);this.selectedIds.set([]);
      this.isolatedGroup.set(null);this.activeState.set('BASE');this.dirty.set(true);
      this.status.set('Imported '+doc.name+' · Save to retain in browser');
    }catch(err){this.status.set('Import rejected: '+String(err));}
  }
  showContext(event:MouseEvent,id:string):void{
    event.preventDefault();event.stopPropagation();
    this.choose(id);
    const selected=this.selectedId()!;
    this.context.set({id:selected,x:Math.max(5,Math.min(innerWidth-190,event.clientX)),
      y:Math.max(5,Math.min(innerHeight-190,event.clientY))});
  }
  duplicateSelected():void{
    const selected=this.selected();
    if(!selected||this.gesture)return;
    const copies:Record<string,string>={};
    const visit=(node:VectorNode):void=>{
      copies[node.id]=randomId(node.kind);
      if(node.kind==='group')node.children.forEach(visit);
    };
    visit(selected);
    this.execute({type:'duplicate',nodeId:selected.id,newIds:copies});
    const copy=copies[selected.id]!;
    if(indexVectorNodes(this.model()).has(copy)){
      this.selectedIds.set([copy]);this.selectedId.set(copy);
    }
    this.context.set(null);
  }
  isolate(id:string):void{
    const target=this.focusTarget(id);
    const node=indexVectorNodes(this.model()).get(target);
    if(node?.kind==='group'){
      this.isolatedGroup.set(target);
      this.selectedId.set(null);this.selectedIds.set([]);
      this.activeTool.set('select');
      this.status.set('Editing group '+node.name+' · Esc to exit');
    }else this.choose(target);
    this.context.set(null);
  }
  backToRoot():void{
    const focus=this.isolatedGroup();
    const parent=focus?nodeLocations(this.model()).get(focus)?.parentId:null;
    this.isolatedGroup.set(parent??null);
    this.selectedId.set(focus);this.selectedIds.set(focus?[focus]:[]);
    this.context.set(null);
  }
  @HostListener('window:keydown',['$event'])
  onKey(event:KeyboardEvent):void{
    if((event.target as HTMLElement)?.closest('input,select,textarea'))return;
    if(event.key==='Escape'){
      if(this.gesture){this.history.cancelGesture();this.gesture=null;this.model.set(this.history.document);}
      else if(this.isolatedGroup())this.backToRoot();
      else this.context.set(null);
      this.drawing=null;this.drawingPreview.set(null);return;
    }
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='g'){
      event.preventDefault();
      if(event.shiftKey)this.ungroupSelected();else this.groupSelected();
      return;
    }
    if(event.key==='F10'&&event.shiftKey&&this.selectedId()){
      event.preventDefault();
      const id=this.selectedId()!;
      this.context.set({id,x:Math.max(12,innerWidth/2-90),y:Math.max(12,innerHeight/2-60)});
      return;
    }
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){
      event.preventDefault();if(event.shiftKey)this.redo();else this.undo();return;
    }
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='d'){
      event.preventDefault();this.duplicateSelected();return;
    }
    if(event.key==='Delete'||event.key==='Backspace'){
      event.preventDefault();this.deleteSelected();
    }
  }
}
