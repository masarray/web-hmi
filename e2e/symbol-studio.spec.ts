import {test,expect} from '@playwright/test';

test('Symbol Studio opens as independent full-page authoring workspace',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  await expect(page.getByTestId('symbol-studio')).toBeVisible();
  await expect(page.getByRole('button',{name:'Line Tool'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Rectangle Tool'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit state Open'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Edit state Closed'})).toBeVisible();
  await expect(page.locator('[data-node-id=blade] line').first()).toHaveAttribute('x1','50');
  await expect(page.locator('[data-handle=end]')).toBeVisible();
  await page.getByRole('button',{name:'Back to HMI Editor'}).click();
  await expect(page.getByTestId('symbol-studio')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Open Symbol Studio'})).toBeVisible();
});

test('line endpoint drag edits only chosen endpoint and Undo restores it',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  const canvas=page.locator('svg.studio-svg');
  const bounds=await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  const end=page.locator('[data-handle=end]');
  const p=await end.boundingBox();
  expect(p).not.toBeNull();
  const center={x:p!.x+p!.width/2,y:p!.y+p!.height/2};
  await page.mouse.move(center.x,center.y);
  await page.mouse.down();
  await page.mouse.move(center.x+55,center.y-33,{steps:8});
  await page.mouse.up();
  const line=page.locator('[data-node-id=blade] line').first();
  await expect(line).toHaveAttribute('x1','50');
  await expect(line).not.toHaveAttribute('x2','50');
  await page.getByRole('button',{name:'Undo Symbol Studio'}).click();
  await expect(line).toHaveAttribute('x2','50');
});

test('per-state style changes stay isolated and save survives reopening',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  const line=page.locator('[data-node-id=blade] line').first();
  await page.getByRole('button',{name:'Edit state Closed'}).click();
  await expect(line).toHaveAttribute('stroke','#65d7aa');
  await page.getByRole('textbox',{name:'Studio stroke color'}).count(); // Use a native input below.
  await page.locator('input[aria-label="Studio stroke color"]').fill('#ff3355');
  await page.locator('input[aria-label="Studio stroke color"]').dispatchEvent('change');
  await expect(line).toHaveAttribute('stroke','#ff3355');
  await page.getByRole('button',{name:'Edit state Open'}).click();
  await expect(line).toHaveAttribute('stroke','#e8b36c');
  await page.getByRole('button',{name:'Edit state Closed'}).click();
  await expect(line).toHaveAttribute('stroke','#ff3355');
  await page.getByRole('button',{name:'Save Symbol Studio'}).click();
  await page.getByRole('button',{name:'Back to HMI Editor'}).click();
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  await page.getByRole('button',{name:'Edit state Closed'}).click();
  await expect(page.locator('[data-node-id=blade] line').first()).toHaveAttribute('stroke','#ff3355');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export Symbol Studio JSON'}).click();
  const result=await download;
  const stream=await result.createReadStream();let json='';
  for await(const buffer of stream)json+=buffer.toString();
  const symbol=JSON.parse(json);
  expect(symbol.version).toBe(2);
  expect(symbol.format).toBe('web-hmi-vector-symbol');
  expect(symbol.states.find((x:{id:string})=>x.id==='CLOSED').overrides.blade.style.stroke)
    .toBe('#ff3355');
});

test('shape creation, context menu and edit canvas preserve HMI Editor',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  const canvas=page.locator('svg.studio-svg');
  const b=await canvas.boundingBox();expect(b).not.toBeNull();
  await page.getByRole('button',{name:'Rectangle Tool'}).click();
  await page.mouse.move(b!.x+b!.width*.15,b!.y+b!.height*.17);
  await page.mouse.down();
  await page.mouse.move(b!.x+b!.width*.35,b!.y+b!.height*.32,{steps:10});
  await page.mouse.up();
  await expect(page.locator('.studio-object rect')).toHaveCount(1);
  const rect=page.locator('.studio-object rect');
  await rect.click({button:'right'});
  await expect(page.getByRole('menu',{name:'Graphic context menu'})).toBeVisible();
  await page.getByRole('menuitem',{name:'Duplicate element'}).click();
  await expect(page.locator('.studio-object rect')).toHaveCount(2);
  await page.getByRole('button',{name:'Back to HMI Editor'}).click();
  await expect(page.getByText('INDUSTRIAL SVG LIBRARY')).toBeVisible();
});

test('New Symbol is neutral and closed-state dragging preserves its rotation override',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  await page.getByRole('button',{name:'New Symbol'}).click();
  await expect(page.getByRole('textbox',{name:'Symbol name'})).toHaveValue('Untitled Symbol');
  await expect(page.locator('.studio-object')).toHaveCount(1);
  await expect(page.locator('[data-node-id=starter-line] line').first()).toBeVisible();
  await page.getByRole('button',{name:'Edit state Closed'}).click();
  const rotation=page.getByRole('spinbutton',{name:'Studio rotation'});
  await rotation.fill('45');
  await rotation.press('Tab');
  const svgLine=page.locator('[data-node-id=starter-line] line').first();
  const box=await svgLine.boundingBox();expect(box).not.toBeNull();
  await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);
  await page.mouse.down();
  await page.mouse.move(box!.x+box!.width/2+30,box!.y+box!.height/2+30,{steps:8});
  await page.mouse.up();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export Symbol Studio JSON'}).click();
  const result=await download;
  const stream=await result.createReadStream();let text='';
  for await(const chunk of stream)text+=chunk.toString();
  const def=JSON.parse(text);
  const changed=def.states.find((state:{id:string})=>state.id==='CLOSED')
    .overrides['starter-line'].transform;
  expect(changed.rotation).toBe(45);
  expect(changed.x).not.toBe(0);
  expect(changed.y).not.toBe(0);
  await page.getByRole('button',{name:'Edit state Open'}).click();
  await expect(page.getByRole('spinbutton',{name:'Studio rotation'})).toHaveValue('0');
});
