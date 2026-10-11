import {test,expect} from '@playwright/test';

test('inline multi-part pump can be added, recolored and moved',async({page})=>{
  await page.goto('/');
  await page.getByRole('searchbox',{name:'Search symbols'}).fill('pumpgear');
  await page.getByRole('button',{name:'Add Pumpgear SVG symbol'}).click();
  const obj=page.locator('g.canvas-node').last();
  const graphic=obj.locator('svg.process-graphic[data-process-id="pumpgear"]');
  await expect(graphic).toBeVisible();
  await expect(graphic.locator('g > path')).toHaveCount(4);
  const stroke=page.getByLabel('Stroke',{exact:true});
  await stroke.fill('#ffaa00');await stroke.press('Tab');
  await expect(graphic.locator('path').first()).toHaveAttribute('stroke','#ffaa00');
  const initial=await obj.getAttribute('transform');
  await graphic.locator('rect[fill="transparent"]').click({force:true});
  await expect(page.getByLabel('Object name')).toHaveValue('Pumpgear');
  const box=await obj.boundingBox();
  expect(box).not.toBeNull();
  const x=box!.x+box!.width/2, y=box!.y+box!.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  await page.mouse.move(x+40,y+30,{steps:5});await page.mouse.up();
  await expect(obj).not.toHaveAttribute('transform',initial!);
  await page.screenshot({path:'test-results/process-graphic-editor.png',fullPage:true});
});

test('rotors move independently and preview animation respects mode',async({page})=>{
  await page.goto('/');
  await page.getByRole('searchbox',{name:'Search symbols'}).fill('motor');
  await page.getByRole('button',{name:'Add Motor Simb SVG symbol'}).click();
  const graphic=page.locator('g.canvas-node').last().locator('svg.process-graphic');
  await expect(graphic.locator('g')).toHaveCount(2);
  await page.getByRole('combobox',{name:'Symbol animation'}).selectOption('spin');
  await expect(graphic.locator('.process-rotor')).toHaveCount(0);
  await page.getByRole('button',{name:/Preview/}).click();
  await expect(graphic.locator('g.process-rotor')).toHaveCount(1);
  await expect.poll(()=>graphic.locator('g.process-rotor').evaluate(
    el=>getComputedStyle(el).animationName)).toMatch(/hmi-part-rotate$/);
  await expect(graphic.locator('g').first()).not.toHaveClass(/process-rotor/);
  await page.getByRole('button',{name:/Exit Preview/}).click();
  await page.reload();
  const restored=page.locator('g.canvas-node').last();
  await restored.click();
  await expect(page.getByRole('combobox',{name:'Symbol animation'})).toHaveValue('spin');
});
