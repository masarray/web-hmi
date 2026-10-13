import {isShape, type Project, type Shape} from './document.ts';
import {pruneDeletedShapeWires} from './port-wires.ts';

export type Align = 'left'|'center'|'right'|'top'|'middle'|'bottom';
export type Axis = 'horizontal'|'vertical';
const between=(n:number)=>Math.max(-10000,Math.min(10000,Math.round(n*100)/100));

function operate(project:Project,ids:readonly string[],apply:(objects:Shape[])=>Map<string,Shape>):Project {
  const chosen=new Set(ids);
  if(chosen.size===0)return project;
  const page=project.pages.find(p=>p.id===project.activePageId);
  if(!page || !page.shapes.some(s=>chosen.has(s.id)))return project;
  const picked=page.shapes.filter(s=>chosen.has(s.id));
  if(picked.length!==chosen.size)throw new Error('Selection contains objects from another page');
  const edited=apply(picked);
  if(edited.size===0)return project;
  const shapes=page.shapes.map(s=>edited.get(s.id)??s);
  if(shapes.every((s,i)=>s===page.shapes[i]))return project;
  if(!shapes.every(isShape))throw new Error('Object operation exceeds valid canvas bounds');
  return {...project,pages:project.pages.map(p=>p.id===page.id?{...p,shapes}:p)};
}
export function alignObjects(project:Project,ids:readonly string[],mode:Align):Project {
  if(ids.length<2)return project;
  return operate(project,ids,objects=>{
    const minX=Math.min(...objects.map(s=>s.x));
    const maxX=Math.max(...objects.map(s=>s.x+s.width));
    const minY=Math.min(...objects.map(s=>s.y));
    const maxY=Math.max(...objects.map(s=>s.y+s.height));
    const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
    const out=new Map<string,Shape>();
    for(const s of objects){
      const x=mode==='left'?minX:mode==='right'?maxX-s.width:
        mode==='center'?cx-s.width/2:s.x;
      const y=mode==='top'?minY:mode==='bottom'?maxY-s.height:
        mode==='middle'?cy-s.height/2:s.y;
      const nx=between(x),ny=between(y);
      if(nx!==s.x || ny!==s.y)out.set(s.id,{...s,x:nx,y:ny});
    }
    return out;
  });
}
export function distributeObjects(project:Project,ids:readonly string[],axis:Axis):Project {
  if(new Set(ids).size<3)return project;
  return operate(project,ids,objects=>{
    const horizontal=axis==='horizontal';
    // Centers provide deterministic distribution regardless of element size.
    // Stable tie breaking by identifier prevents random ordering on repeated use.
    const ordered=[...objects].sort((a,b)=>{
      const av=horizontal?a.x+a.width/2:a.y+a.height/2;
      const bv=horizontal?b.x+b.width/2:b.y+b.height/2;
      return av-bv || a.id.localeCompare(b.id);
    });
    const first=ordered[0]!,last=ordered.at(-1)!;
    const start=horizontal?first.x+first.width/2:first.y+first.height/2;
    const finish=horizontal?last.x+last.width/2:last.y+last.height/2;
    const step=(finish-start)/(ordered.length-1);
    const out=new Map<string,Shape>();
    for(let i=1;i<ordered.length-1;i++){
      const s=ordered[i]!;
      const pos=between(start+step*i-(horizontal?s.width:s.height)/2);
      if(horizontal && pos!==s.x)out.set(s.id,{...s,x:pos});
      if(!horizontal && pos!==s.y)out.set(s.id,{...s,y:pos});
    }
    return out;
  });
}
export function moveObjects(project:Project,ids:readonly string[],dx:number,dy:number):Project {
  if(!Number.isFinite(dx)||!Number.isFinite(dy))throw new Error('Invalid move');
  if(dx===0 && dy===0)return project;
  return operate(project,ids,objects=>{
    const out=new Map<string,Shape>();
    for(const s of objects){
      const x=between(s.x+dx),y=between(s.y+dy);
      if(x!==s.x || y!==s.y)out.set(s.id,{...s,x,y});
    }
    return out;
  });
}
export function deleteObjects(project:Project,ids:readonly string[]):Project {
  const selected=new Set(ids);
  if(!selected.size)return project;
  const page=project.pages.find(p=>p.id===project.activePageId);
  if(!page)return project;
  const shapes=page.shapes.filter(s=>!selected.has(s.id));
  if(shapes.length===page.shapes.length)return project;
  return {...project,pages:project.pages.map(p=>p.id===page.id?
    pruneDeletedShapeWires(p,shapes):p)};
}
