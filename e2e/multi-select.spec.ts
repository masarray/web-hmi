import {test,expect} from '@playwright/test';

const layer=(page:import('@playwright/test').Page,name:string)=>
  page.locator('.layers button').filter({hasText:name});
const shape=(page:import('@playwright/test').Page,id:string)=>
  page.locator('g.canvas-node[data-shape-id="'+id+'"]');

test('Shift-select layers and align objects with one undo',async({page})=>{
  await page.goto('/');
  await layer(page,'CB Bay A').click();
  await layer(page,'CB Bay B').click({modifiers:['Shift']});
  await expect(page.getByText('2 objects selected')).toBeVisible();
  await expect(page.getByRole('button',{name:'Left',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Left',exact:true}).click();
  await expect(shape(page,'cb-b')).toHaveAttribute('transform','translate(247,265)');
  await page.getByRole('button',{name:/Undo/}).click();
  await expect(shape(page,'cb-b')).toHaveAttribute('transform','translate(562,265)');
  await page.getByRole('button',{name:/Redo/}).click();
  await expect(shape(page,'cb-b')).toHaveAttribute('transform','translate(247,265)');
  await page.reload();
  await expect(shape(page,'cb-b')).toHaveAttribute('transform','translate(247,265)');
});

test('three-object center distribution corrects spacing',async({page})=>{
  await page.goto('/');
  await layer(page,'CB Bay B').click();
  const x=page.getByLabel('X', {exact:true});
  await x.fill('630');await x.press('Tab');
  await expect(shape(page,'cb-b')).toHaveAttribute('transform','translate(630,265)');
  await layer(page,'CB Bay A').click();
  await layer(page,'CB Bay B').click({modifiers:['Shift']});
  await layer(page,'CB Bay C').click({modifiers:['Shift']});
  await expect(page.getByText('3 objects selected')).toBeVisible();
  await page.getByRole('button',{name:'Horizontal',exact:true}).click();
  await expect(shape(page,'cb-b')).toHaveAttribute('transform','translate(562,265)');
});

test('multi-object drag moves both and the group can be deleted and undone',async({page})=>{
  await page.goto('/');
  await layer(page,'CB Bay A').click();
  await layer(page,'CB Bay B').click({modifiers:['Shift']});
  const selected=shape(page,'cb-a'),bounds=await selected.boundingBox();
  expect(bounds).not.toBeNull();
  const cx=bounds!.x+bounds!.width/2,cy=bounds!.y+bounds!.height/2;
  await page.mouse.move(cx,cy);await page.mouse.down();
  await page.mouse.move(cx+45,cy+30,{steps:8});await page.mouse.up();
  await expect(selected).not.toHaveAttribute('transform','translate(247,265)');
  await expect(shape(page,'cb-b')).not.toHaveAttribute('transform','translate(562,265)');
  const movedA=await selected.getAttribute('transform');
  const movedB=await shape(page,'cb-b').getAttribute('transform');
  await page.getByRole('button',{name:/Delete 2 selected objects/}).click();
  await expect(selected).toHaveCount(0);
  await expect(shape(page,'cb-b')).toHaveCount(0);
  await page.getByRole('button',{name:/Undo/}).click();
  await expect(shape(page,'cb-a')).toHaveAttribute('transform',movedA!);
  await expect(shape(page,'cb-b')).toHaveAttribute('transform',movedB!);
});

test('select all, escape and mixed selection are discoverable',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Select all objects (Ctrl+A)'}).click();
  await expect(page.getByText('11 objects selected')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('11 objects selected')).toHaveCount(0);
  await layer(page,'CB Bay A').click();
  await layer(page,'CB Bay B').click({modifiers:['Control']});
  await expect(page.getByText('2 objects selected')).toBeVisible();
  await layer(page,'CB Bay B').click({modifiers:['Control']});
  await expect(page.getByText('2 objects selected')).toHaveCount(0);
  await expect(page.getByLabel('Object name')).toBeVisible();
});
