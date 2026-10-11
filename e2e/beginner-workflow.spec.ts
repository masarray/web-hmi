import {test,expect} from '@playwright/test';

test('beginner flow: name project and page, click-add, duplicate and undo',async({page})=>{
  await page.goto('/');
  await page.getByLabel('Project name').fill('My Pump Station');
  await page.getByLabel('Project name').press('Tab');
  await expect(page.locator('.project-title')).toContainText('My Pump Station');
  await page.getByLabel('Page name').fill('Main screen');
  await page.getByLabel('Page name').press('Tab');
  await expect(page.getByRole('button',{name:/Main screen/})).toBeVisible();
  const nodes=page.locator('g.canvas-node');
  const count=await nodes.count();
  await page.getByRole('button',{name:/Rectangle/}).first().click();
  await expect(nodes).toHaveCount(count+1);
  await page.getByRole('button',{name:/Duplicate selected/}).click();
  await expect(nodes).toHaveCount(count+2);
  await page.getByRole('button',{name:/Undo/}).click();
  await expect(nodes).toHaveCount(count+1);
  await page.getByRole('button',{name:/Redo/}).click();
  await expect(nodes).toHaveCount(count+2);
  await page.reload();
  await expect(page.locator('.project-title')).toContainText('My Pump Station');
  await expect(nodes).toHaveCount(count+2);
});

test('drag shape from palette to canvas and resize by handle',async({page})=>{
  await page.goto('/');
  const nodes=page.locator('g.canvas-node');
  const original=await nodes.count();
  await page.getByRole('button',{name:/Ellipse/}).dragTo(page.locator('svg.viewport'),{
    targetPosition:{x:280,y:180}
  });
  await expect(nodes).toHaveCount(original+1);
  const element=nodes.last();
  const widthBefore=Number(await element.locator('ellipse').getAttribute('rx'));
  const handle=element.locator('circle.resize-handle');
  await expect(handle).toBeVisible();
  const box=await handle.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);
  await page.mouse.down();
  await page.mouse.move(box!.x+box!.width/2+65,box!.y+box!.height/2+45,{steps:6});
  await page.mouse.up();
  const widthAfter=Number(await element.locator('ellipse').getAttribute('rx'));
  expect(widthAfter).toBeGreaterThan(widthBefore);
  await page.reload();
  const final=page.locator('g.canvas-node').last();
  expect(Number(await final.locator('ellipse').getAttribute('rx'))).toBe(widthAfter);
});

test('layer order and page management remain reversible',async({page})=>{
  await page.goto('/');
  const original=page.locator('g.canvas-node');
  await original.nth(5).click();
  await expect(page.getByRole('button',{name:'Bring to front'})).toBeVisible();
  await page.getByRole('button',{name:'Bring to front'}).click();
  await expect(page.locator('g.canvas-node').last()).toContainText('');
  await expect(page.locator('g.canvas-node').last()).toHaveAttribute('transform',/translate\(247,265\)/);
  await page.getByRole('button',{name:'Send to back'}).click();
  await expect(page.locator('g.canvas-node').first()).toHaveAttribute('transform',/translate\(247,265\)/);
  await page.getByRole('button',{name:/New page/}).click();
  await expect(page.getByLabel('Page name')).toBeVisible();
  await page.getByLabel('Page name').fill('My second page');
  await page.getByLabel('Page name').press('Tab');
  await expect(page.getByRole('button',{name:/My second page/})).toBeVisible();
  await page.getByRole('button',{name:/Delete this page/}).click();
  await expect(page.getByRole('button',{name:/My second page/})).toHaveCount(0);
  await page.getByRole('button',{name:/Undo/}).click();
  await expect(page.getByRole('button',{name:/My second page/})).toBeVisible();
});
