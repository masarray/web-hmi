import { ChangeDetectionStrategy, Component, ElementRef, HostListener,
  ViewChild, computed, signal } from '@angular/core';
import { Project, Shape, ShapeKind, ShapeEdit, initialProject, parseProject,
  newShape, insertShape, editShape, deleteShape, createPage } from './document';

const STORAGE_KEY='web-hmi.project.v1';
type Drag={id:string;pointerId:number;startX:number;startY:number;baseX:number;baseY:number};

@Component({
  selector:'hmi-root', standalone:true, imports:[],
  templateUrl:'./editor.component.html',
  styleUrl:'./editor.component.css',
  changeDetection:ChangeDetectionStrategy.OnPush
})
export class EditorComponent {
  @ViewChild('viewport') viewport?:ElementRef<SVGSVGElement>;
  readonly project=signal<Project>(this.restore());
  readonly selectedId=signal<string|null>(null);
  readonly snapEnabled=signal(true);
  readonly gridVisible=signal(true);
  readonly previewMode=signal(false);
  readonly zoom=signal(1);
  readonly status=signal('Editor ready · local project');
  readonly canUndo=signal(false);
  readonly canRedo=signal(false);
  readonly activePage=computed(()=>
    this.project().pages.find(p=>p.id===this.project().activePageId)!);
  readonly selected=computed(()=>
    this.activePage().shapes.find(s=>s.id===this.selectedId())??null);
  readonly preview=signal<{id:string;x:number;y:number}|null>(null);
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
    this.canUndo.set(true);
    this.canRedo.set(false);
    this.persist();
  }
  undo():void {
    const previous=this.past.pop();
    if (!previous) return;
    this.future.push(this.project());
    this.project.set(previous);
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
      this.selectedId.set(shape.id);
    } catch(error) { this.status.set(String(error)); }
  }
  removeSelected():void {
    const id=this.selectedId();
    if (!id) return;
    this.record(deleteShape(this.project(),id));
    this.selectedId.set(null);
  }
  addPage():void {
    try {
      this.record(createPage(this.project()));
      this.selectedId.set(null);
    } catch(error) { this.status.set(String(error)); }
  }
  selectPage(id:string):void {
    if (!this.project().pages.some(p=>p.id===id)) return;
    this.record({...this.project(),activePageId:id});
    this.selectedId.set(null);
  }
  toggleGrid():void { this.gridVisible.update(v=>!v); }
  toggleSnap():void { this.snapEnabled.update(v=>!v); }
  togglePreview():void { this.previewMode.update(v=>!v);this.selectedId.set(null); }
  zoomBy(delta:number):void {
    this.zoom.update(value=>Math.min(2.5,Math.max(0.5,Math.round((value+delta)*10)/10)));
  }
  displayX(s:Shape):number {
    const p=this.preview();
    return p?.id===s.id?p.x:s.x;
  }
  displayY(s:Shape):number {
    const p=this.preview();
    return p?.id===s.id?p.y:s.y;
  }
  onCanvasDown():void {
    if (!this.previewMode()) this.selectedId.set(null);
  }
  private pointerToCanvas(e:PointerEvent):{x:number;y:number}|null {
    const svg=this.viewport?.nativeElement;
    const ctm=svg?.getScreenCTM();
    if (!ctm) return null;
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(ctm.inverse());
    return {x:p.x,y:p.y};
  }
  beginDrag(e:PointerEvent,s:Shape):void {
    if (e.button!==0 || this.previewMode()) return;
    e.stopPropagation();
    this.selectedId.set(s.id);
    const point=this.pointerToCanvas(e);
    if (!point) return;
    this.drag={id:s.id,pointerId:e.pointerId,startX:point.x,startY:point.y,
      baseX:s.x,baseY:s.y};
    this.viewport?.nativeElement.setPointerCapture(e.pointerId);
  }
  movePointer(e:PointerEvent):void {
    const d=this.drag;
    if (!d || d.pointerId!==e.pointerId) return;
    const p=this.pointerToCanvas(e);
    if (!p) return;
    this.preview.set({id:d.id,x:this.round(d.baseX+p.x-d.startX),
      y:this.round(d.baseY+p.y-d.startY)});
  }
  endPointer(e:PointerEvent):void {
    const d=this.drag;
    if (!d || d.pointerId!==e.pointerId) return;
    const preview=this.preview();
    this.drag=null;
    this.preview.set(null);
    const svg=this.viewport?.nativeElement;
    if (svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
    if (preview && preview.id===d.id) {
      try { this.record(editShape(this.project(),d.id,{x:preview.x,y:preview.y})); }
      catch(error) { this.status.set(String(error)); }
    }
  }
  private round(n:number):number {
    return this.snapEnabled()?Math.round(n/10)*10:Math.round(n);
  }
  updateProperty(key:keyof ShapeEdit,e:Event):void {
    const selected=this.selected();
    if (!selected) return;
    const target=e.target as HTMLInputElement;
    const value=['x','y','width','height'].includes(key)?
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
      this.selectedId.set(null);
      this.status.set('Validated project imported');
    } catch(error) { this.status.set('Import rejected: '+String(error)); }
  }
  @HostListener('window:keydown',['$event'])
  shortcut(e:KeyboardEvent):void {
    const node=e.target as HTMLElement|null;
    if (node?.closest('input,textarea,[contenteditable="true"]')) return;
    const modifier=e.ctrlKey||e.metaKey;
    if (modifier && e.key.toLowerCase()==='z') {
      e.preventDefault();e.shiftKey?this.redo():this.undo();return;
    }
    if (modifier && e.key.toLowerCase()==='y') {
      e.preventDefault();this.redo();return;
    }
    if (e.key==='Delete'||e.key==='Backspace') {
      if (this.selectedId()) {e.preventDefault();this.removeSelected();}
      return;
    }
    const step=e.shiftKey?10:1;
    const arrows:Record<string,[number,number]>={
      ArrowLeft:[-step,0],ArrowRight:[step,0],
      ArrowUp:[0,-step],ArrowDown:[0,step]
    };
    const move=arrows[e.key],s=this.selected();
    if (move && s && !this.previewMode()) {
      e.preventDefault();
      try {this.record(editShape(this.project(),s.id,{
        x:Math.round(s.x+move[0]!),y:Math.round(s.y+move[1]!)
      }));} catch(error){this.status.set(String(error));}
    }
  }
}
