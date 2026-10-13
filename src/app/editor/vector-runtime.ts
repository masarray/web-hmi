/**
 * Read-only, protocol-neutral SVG rendering projection of Symbol Studio V2.
 * Shared with the editor model: no duplicate geometry, no per-symbol timers.
 */
import {product,transformMatrix,type Affine,IDENTITY} from './symbol-studio-geometry.ts';
import {resolveVectorFrame,type VectorNode,type VectorSymbol,type VectorStyle,
  type VectorFrame,type Vector2,type SignalEncoding} from './symbol-studio-model.ts';
import type {TagSample} from './visual-runtime.ts';

export interface RenderVectorNode {
  readonly node:Exclude<VectorNode,{kind:'group'}>;
  readonly matrix:Affine;
  readonly style:VectorStyle;
  readonly text:string|undefined;
  readonly visible:boolean;
}
export interface RenderVectorSymbol {
  readonly frame:VectorFrame;
  readonly rows:readonly RenderVectorNode[];
}
export function projectVectorFrame(doc:VectorSymbol,encoding:SignalEncoding,
  sample:TagSample|undefined,nowMs:number,preview:boolean,bound:boolean):RenderVectorSymbol {
  const frame=resolveVectorFrame(doc,encoding,sample,nowMs,preview,bound);
  const rows:RenderVectorNode[]=[];
  const traverse=(nodes:readonly VectorNode[],parent:Affine,visible:boolean)=>{
    for(const node of nodes){
      const appearance=frame.nodes.get(node.id);
      if(!appearance)throw Error('Missing resolved vector node '+node.id);
      const active=visible&&appearance.visible;
      const matrix=product(parent,transformMatrix(appearance.transform));
      if(node.kind==='group'){
        traverse(node.children,matrix,active);
      }else if(active){
        rows.push({node,matrix,style:appearance.style!,text:appearance.text,visible:active});
      }
    }
  };
  traverse(doc.nodes,IDENTITY,true);
  return {frame,rows};
}
/** Portable definition identity is case sensitive, as are node/state IDs. */
export function vectorSymbolIdAllowed(id:string):boolean{
  return /^user-[A-Za-z0-9_-]{1,64}$/.test(id)&&id.length<=64;
}
export function symbolDimensions(doc:VectorSymbol):Vector2{
  const [width,height]=doc.viewBox;
  const longest=Math.max(width,height);
  const factor=longest>140?140/longest:longest<55?55/longest:1;
  return [Math.max(1,width*factor),Math.max(1,height*factor)];
}
