/**
 * Native document grouping, with stable node IDs and no SVG DOM as authority.
 * Every structural operation produces one history transaction.
 */
import {parseVectorSymbol,type VectorSymbol,type VectorNode,type GroupNode,
  type VectorTransform,type NodeOverride} from './symbol-studio-model.ts';
import {product,transformMatrix,type Affine} from './symbol-studio-geometry.ts';

export const GROUP_IDENTITY:VectorTransform={
  x:0,y:0,rotation:0,scaleX:1,scaleY:1,pivot:[0,0]
};
type Location={readonly parentId:string|null;readonly index:number};
export function nodeLocations(doc:Pick<VectorSymbol,'nodes'>):Map<string,Location>{
  const found=new Map<string,Location>();
  function walk(nodes:readonly VectorNode[],parentId:string|null):void{
    nodes.forEach((node,index)=>{
      found.set(node.id,{parentId,index});
      if(node.kind==='group')walk(node.children,node.id);
    });
  }
  walk(doc.nodes,null);return found;
}
function updateChildren(doc:VectorSymbol,parentId:string|null,
  update:(nodes:readonly VectorNode[])=>readonly VectorNode[]):VectorSymbol{
  if(parentId===null)return {...doc,nodes:[...update(doc.nodes)]};
  let found=false;
  function walk(nodes:readonly VectorNode[]):VectorNode[]{
    return nodes.map(node=>{
      if(node.id===parentId){
        if(node.kind!=='group')throw Error('Group parent is no longer valid');
        found=true;return {...node,children:[...update(node.children)]};
      }
      return node.kind==='group'?{...node,children:walk(node.children)}:node;
    });
  }
  const changed=walk(doc.nodes);
  if(!found)throw Error('Missing group parent');
  return {...doc,nodes:changed};
}
export function groupVectorNodes(doc:VectorSymbol,ids:readonly string[],
  id:string,name='Group'):VectorSymbol{
  if(ids.length<2||ids.length>128||new Set(ids).size!==ids.length)
    throw Error('Select at least two distinct elements to group');
  const locations=nodeLocations(doc);
  const parents=ids.map(key=>locations.get(key));
  if(parents.some(x=>!x))throw Error('Group selection contains a missing object');
  const parentId=parents[0]!.parentId;
  if(parents.some(x=>x!.parentId!==parentId))
    throw Error('Group members must belong to the same parent');
  if(locations.has(id))throw Error('Group ID already exists');
  const selected=new Set(ids);
  const next=updateChildren(doc,parentId,nodes=>{
    const members=nodes.filter(n=>selected.has(n.id));
    const first=nodes.findIndex(n=>selected.has(n.id));
    if(members.length!==ids.length||first<0)throw Error('Invalid grouping selection');
    const group:GroupNode={id,name,kind:'group',visible:true,
      transform:GROUP_IDENTITY,children:members};
    return [...nodes.slice(0,first).filter(n=>!selected.has(n.id)),
      group,...nodes.slice(first).filter(n=>!selected.has(n.id))];
  });
  return parseVectorSymbol(next);
}
function finite(n:number):number{
  if(!Number.isFinite(n))throw Error('Non-finite group transform');
  return Math.abs(n)<1e-10?0:n;
}
/** Exact affine decomposition; reject shear that V2 cannot encode losslessly. */
export function transformFromAffine(m:Affine,pivot:readonly [number,number]):VectorTransform{
  const scaleX=Math.hypot(m.a,m.b);
  if(scaleX<1e-9)throw Error('Cannot ungroup: singular child transform');
  const rotation=Math.atan2(m.b,m.a);
  const orthogonal=(m.a*m.c+m.b*m.d)/scaleX;
  if(Math.abs(orthogonal)>1e-7)
    throw Error('Cannot ungroup sheared transforms without losing geometry');
  const scaleY=(m.a*m.d-m.b*m.c)/scaleX;
  const [px,py]=pivot;
  return {x:finite(m.e-px+m.a*px+m.c*py),
    y:finite(m.f-py+m.b*px+m.d*py),
    rotation:finite(rotation*180/Math.PI),
    scaleX:finite(scaleX),scaleY:finite(scaleY),pivot:[px,py]};
}
function effectiveTransform(base:VectorTransform,override:NodeOverride|undefined):VectorTransform{
  return {...base,...(override?.transform??{})};
}
function eq(a:unknown,b:unknown):boolean{return JSON.stringify(a)===JSON.stringify(b);}
export function ungroupVectorNode(doc:VectorSymbol,id:string):VectorSymbol{
  const locations=nodeLocations(doc),where=locations.get(id);
  if(!where)throw Error('Unknown group');
  let group:GroupNode|undefined;
  function locate(nodes:readonly VectorNode[]):void{
    for(const n of nodes){
      if(n.id===id&&n.kind==='group'){group=n;return;}
      if(n.kind==='group')locate(n.children);
      if(group)return;
    }
  }
  locate(doc.nodes);
  if(!group)throw Error('Select a group to ungroup');
  const original=group;
  // Every child keeps its ID and state-specific overrides. Flatten only the
  // group's relative transform so visual position/state remains identical.
  const baseChildren=new Map<string,VectorNode>();
  const rebased=original.children.map(child=>{
    const transform=transformFromAffine(
      product(transformMatrix(original.transform),transformMatrix(child.transform)),
      child.transform.pivot);
    const rewritten={...child,transform,visible:original.visible&&child.visible} as VectorNode;
    baseChildren.set(child.id,rewritten);
    return rewritten;
  });
  const newStates=doc.states.map(state=>{
    const overrides={...state.overrides};
    const parentOverride=state.overrides[id];
    for(const child of original.children){
      const originalOverride=state.overrides[child.id]??{};
      const parentTransform=effectiveTransform(original.transform,parentOverride);
      const childTransform=effectiveTransform(child.transform,originalOverride);
      const effective=transformFromAffine(
        product(transformMatrix(parentTransform),transformMatrix(childTransform)),
        child.transform.pivot);
      const rebasedBase=baseChildren.get(child.id)!.transform;
      const baseVisibility=original.visible&&child.visible;
      const activeVisibility=(parentOverride?.visible??original.visible)&&
        (originalOverride.visible??child.visible);
      const updated:{-readonly [K in keyof NodeOverride]:NodeOverride[K]}={...originalOverride};
      if(!eq(effective,rebasedBase))updated.transform=effective;
      else delete (updated as {transform?:unknown}).transform;
      if(activeVisibility!==baseVisibility)updated.visible=activeVisibility;
      else delete (updated as {visible?:unknown}).visible;
      if(Object.keys(updated).length)overrides[child.id]=updated;
      else delete overrides[child.id];
    }
    delete overrides[id];
    return {...state,overrides};
  });
  const next=updateChildren({...doc,states:newStates},where.parentId,nodes=>{
    const location=nodes.findIndex(n=>n.id===id);
    if(location<0)throw Error('Ungroup target disappeared');
    return [...nodes.slice(0,location),...rebased,...nodes.slice(location+1)];
  });
  return parseVectorSymbol(next);
}

/** Deep copy including descendants and each state override. */
export function duplicateVectorSubtree(doc:VectorSymbol,id:string,
  idMap:Readonly<Record<string,string>>,offset=10):VectorSymbol{
  const locations=nodeLocations(doc),where=locations.get(id);
  if(!where)throw Error('Unknown duplicate target');
  let target:VectorNode|undefined;
  function find(nodes:readonly VectorNode[]):void{
    for(const node of nodes){
      if(node.id===id){target=node;return;}
      if(node.kind==='group')find(node.children);
      if(target)return;
    }
  }
  find(doc.nodes);
  if(!target)throw Error('Missing duplicate subtree');
  const selected=new Set<string>();
  const clone=(node:VectorNode,root:boolean):VectorNode=>{
    const newId=idMap[node.id];
    if(!newId||selected.has(newId)||locations.has(newId))
      throw Error('Duplicate needs a distinct ID for every nested element');
    selected.add(newId);
    const transform=root?{...node.transform,x:node.transform.x+offset,
      y:node.transform.y+offset}:node.transform;
    const name=root?(node.name+' copy').slice(0,80):node.name;
    if(node.kind==='group')return {...node,id:newId,name,transform,
      children:node.children.map(n=>clone(n,false))};
    return {...node,id:newId,name,transform};
  };
  const duplicate=clone(target,true);
  const states=doc.states.map(state=>{
    const overrides={...state.overrides};
    for(const [oldId,newId] of Object.entries(idMap)){
      if(state.overrides[oldId]){
        const old=state.overrides[oldId]!;
        const patch=oldId===id && old.transform?{
          ...old,transform:{...old.transform,
            ...(old.transform.x!==undefined?{x:old.transform.x+offset}:{}),
            ...(old.transform.y!==undefined?{y:old.transform.y+offset}:{})}
        }:old;
        overrides[newId]=patch;
      }
    }
    return {...state,overrides};
  });
  const next=updateChildren({...doc,states},where.parentId,nodes=>{
    const pos=nodes.findIndex(n=>n.id===id);
    if(pos<0)throw Error('Duplicate target disappeared');
    return [...nodes.slice(0,pos+1),duplicate,...nodes.slice(pos+1)];
  });
  return parseVectorSymbol(next);
}
