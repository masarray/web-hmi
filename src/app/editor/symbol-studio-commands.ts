/**
 * Symbol Studio V2 transactional edit engine.
 * Every interactive gesture previews against a fixed base snapshot and commits
 * to Undo exactly once; pointermove must never persist/serialize full projects.
 */
import {parseVectorSymbol,indexVectorNodes,
  type VectorSymbol,type VectorNode,type NodeOverride} from './symbol-studio-model.ts';

export type OverrideField=
  'visible'|'text'|'style.fill'|'style.stroke'|'style.strokeWidth'|'style.opacity'|
  'transform.x'|'transform.y'|'transform.rotation'|'transform.scaleX'|
  'transform.scaleY'|'transform.pivot';
export type SymbolEdit=
  |{readonly type:'insert';readonly node:VectorNode;
    readonly parentId?:string;readonly at?:number}
  |{readonly type:'replace';readonly node:VectorNode}
  |{readonly type:'remove';readonly nodeId:string}
  |{readonly type:'state-override';readonly stateId:string;readonly nodeId:string;
    readonly patch:NodeOverride}
  |{readonly type:'reset-override';readonly stateId:string;readonly nodeId:string;
    readonly field?:OverrideField};

function updateNodes(items:readonly VectorNode[],id:string,
  operation:(node:VectorNode)=>VectorNode):VectorNode[]{
  return items.map(node=>node.id===id?operation(node):
    node.kind==='group'?{...node,children:updateNodes(node.children,id,operation)}:node);
}
function insertNode(items:readonly VectorNode[],parentId:string|undefined,
  node:VectorNode,index:number|undefined):VectorNode[]{
  if(parentId===undefined){
    const at=index===undefined?items.length:Math.max(0,Math.min(items.length,index));
    const result=[...items];result.splice(at,0,node);return result;
  }
  return updateNodes(items,parentId,parent=>{
    if(parent.kind!=='group')throw Error('Selected parent is not a group');
    const siblings=[...parent.children];
    const at=index===undefined?siblings.length:Math.max(0,Math.min(siblings.length,index));
    siblings.splice(at,0,node);
    return {...parent,children:siblings};
  });
}
function dropNode(items:readonly VectorNode[],id:string):VectorNode[]{
  return items.flatMap(node=>node.id===id?[]:[node.kind==='group'?
    {...node,children:dropNode(node.children,id)}:node]);
}
function subtreeIds(root:VectorNode):Set<string>{
  const ids=new Set<string>();
  const visit=(node:VectorNode)=>{
    ids.add(node.id);
    if(node.kind==='group')node.children.forEach(visit);
  };
  visit(root);
  return ids;
}
function removeField(value:NodeOverride,field:OverrideField):NodeOverride{
  const [section,attribute]=field.split('.') as [string,string|undefined];
  if(!attribute){
    const copy={...value} as Record<string,unknown>;
    delete copy[section];
    return copy as NodeOverride;
  }
  if(section!=='style'&&section!=='transform')throw Error('Invalid override section');
  const nested={...(section==='style'?value.style:value.transform)} as Record<string,unknown>;
  delete nested[attribute];
  const copy={...value};
  if(Object.keys(nested).length===0){
    const writable={...copy} as Record<string,unknown>;
    delete writable[section];
    return writable as NodeOverride;
  }
  return {...copy,[section]:nested};
}
export function applySymbolEdit(doc:VectorSymbol,edit:SymbolEdit):VectorSymbol{
  const nodes=indexVectorNodes(doc);
  let next:VectorSymbol;
  if(edit.type==='insert'){
    if(nodes.has(edit.node.id))throw Error('Node ID already exists');
    if(edit.parentId!==undefined&&!nodes.has(edit.parentId))throw Error('Unknown group parent');
    next={...doc,nodes:insertNode(doc.nodes,edit.parentId,edit.node,edit.at)};
  }else if(edit.type==='replace'){
    const old=nodes.get(edit.node.id);
    if(!old)throw Error('Unknown vector node');
    if(old.kind!==edit.node.kind)throw Error('Change primitive through explicit migration');
    next={...doc,nodes:updateNodes(doc.nodes,edit.node.id,()=>edit.node)};
  }else if(edit.type==='remove'){
    const root=nodes.get(edit.nodeId);
    if(!root)throw Error('Unknown vector node');
    const removed=subtreeIds(root);
    next={...doc,nodes:dropNode(doc.nodes,edit.nodeId),
      states:doc.states.map(s=>({...s,overrides:Object.fromEntries(
        Object.entries(s.overrides).filter(([id])=>!removed.has(id))
      )}))};
  }else{
    if(!nodes.has(edit.nodeId))throw Error('Unknown vector node');
    if(!doc.states.some(s=>s.id===edit.stateId))throw Error('Unknown symbol state');
    next={...doc,states:doc.states.map(state=>{
      if(state.id!==edit.stateId)return state;
      const current=state.overrides[edit.nodeId]??{};
      const patched=edit.type==='state-override'?{
        ...current,...edit.patch,
        ...(edit.patch.style!==undefined?{
          style:{...current.style,...edit.patch.style}}:{}),
        ...(edit.patch.transform!==undefined?{
          transform:{...current.transform,...edit.patch.transform}}:{})
      }:edit.field?removeField(current,edit.field):{};
      const overrides={...state.overrides};
      if(Object.keys(patched).length)overrides[edit.nodeId]=patched;
      else delete overrides[edit.nodeId];
      return {...state,overrides};
    })};
  }
  // Immutable, validated canonical output. Unsafe tree cycles/missing refs cannot commit.
  return parseVectorSymbol(next);
}
export class SymbolEditHistory{
  private committed:VectorSymbol;
  private draft:VectorSymbol|null=null;
  private base:VectorSymbol|null=null;
  private readonly undoStack:VectorSymbol[]=[];
  private readonly redoStack:VectorSymbol[]=[];
  constructor(source:VectorSymbol,private readonly limit=60){
    if(!Number.isInteger(limit)||limit<1||limit>200)throw Error('Invalid history limit');
    this.committed=parseVectorSymbol(source);
  }
  get document():VectorSymbol{return this.draft??this.committed;}
  get isGestureActive():boolean{return this.base!==null;}
  get canUndo():boolean{return this.undoStack.length>0;}
  get canRedo():boolean{return this.redoStack.length>0;}
  private save(next:VectorSymbol):boolean{
    if(JSON.stringify(next)===JSON.stringify(this.committed))return false;
    this.undoStack.push(this.committed);
    if(this.undoStack.length>this.limit)this.undoStack.shift();
    this.redoStack.length=0;
    this.committed=next;
    return true;
  }
  execute(edit:SymbolEdit):boolean{
    if(this.base)throw Error('Finish the active gesture before issuing a command');
    return this.save(applySymbolEdit(this.committed,edit));
  }
  beginGesture():void{
    if(this.base)throw Error('Gesture already active');
    this.base=this.committed;
    this.draft=this.base;
  }
  previewGesture(edit:SymbolEdit):VectorSymbol{
    if(!this.base)throw Error('No active gesture');
    // Every preview is based on the state at pointerdown, not last pointermove.
    const updated=applySymbolEdit(this.base,edit);
    this.draft=updated;
    return updated;
  }
  commitGesture():boolean{
    if(!this.base)throw Error('No active gesture');
    const result=this.draft!;
    this.base=null;this.draft=null;
    return this.save(result);
  }
  cancelGesture():void{
    this.base=null;this.draft=null;
  }
  undo():boolean{
    if(this.base)throw Error('Cannot undo during gesture');
    const previous=this.undoStack.pop();
    if(!previous)return false;
    this.redoStack.push(this.committed);
    this.committed=previous;
    return true;
  }
  redo():boolean{
    if(this.base)throw Error('Cannot redo during gesture');
    const next=this.redoStack.pop();
    if(!next)return false;
    this.undoStack.push(this.committed);
    this.committed=next;
    return true;
  }
}
