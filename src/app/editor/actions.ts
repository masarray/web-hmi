import {makeId, type Project, type Shape} from './document.ts';

/** A document operation owns model ordering; the Angular view owns no hidden SVG DOM state. */
export function duplicateShape(p:Project,id:string):{project:Project;newId:string} {
  const source=p.pages.find(page=>page.id===p.activePageId)?.shapes.find(s=>s.id===id);
  if(!source) throw new Error('Select an existing object first');
  const newId=makeId('shape');
  const clone:Shape={...source,id:newId,name:source.name.slice(0,90)+' copy',
    x:Math.min(10000,source.x+20),y:Math.min(10000,source.y+20)};
  const project={...p,pages:p.pages.map(page=>page.id===p.activePageId
    ? {...page,shapes:[...page.shapes,clone]} : page)};
  if(project.pages.find(page=>page.id===p.activePageId)!.shapes.length>2000)
    throw new Error('Maximum 2000 objects per page');
  return {project,newId};
}
export function reorderShape(p:Project,id:string,direction:'front'|'back'):Project {
  return {...p,pages:p.pages.map(page=>{
    if(page.id!==p.activePageId) return page;
    const index=page.shapes.findIndex(s=>s.id===id);
    if(index<0) return page;
    const shapes=[...page.shapes];
    const [shape]=shapes.splice(index,1);
    if(!shape) return page;
    if(direction==='front') shapes.push(shape);
    else shapes.unshift(shape);
    return {...page,shapes};
  })};
}
function cleanedName(value:string,max:number):string {
  const name=value.trim();
  if(!name || name.length>max) throw new Error('Name cannot be empty or too long');
  return name;
}
export function renameProject(p:Project,value:string):Project {
  return {...p,name:cleanedName(value,120)};
}
export function renamePage(p:Project,id:string,value:string):Project {
  const name=cleanedName(value,120);
  if(!p.pages.some(page=>page.id===id)) throw new Error('Page not found');
  if(p.pages.some(page=>page.id!==id && page.name.toLowerCase()===name.toLowerCase()))
    throw new Error('Each page requires a unique name');
  return {...p,pages:p.pages.map(page=>page.id===id?{...page,name}:page)};
}
export function deletePage(p:Project,id:string):Project {
  if(p.pages.length===1) throw new Error('At least one page is required');
  if(!p.pages.some(page=>page.id===id)) throw new Error('Page not found');
  const pages=p.pages.filter(page=>page.id!==id);
  return {...p,pages,activePageId:p.activePageId===id?pages[0]!.id:p.activePageId};
}
