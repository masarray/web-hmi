import {test,expect} from '@playwright/test';

test('visual ports: create, rename, drag, undo and persist in project library',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  await page.getByRole('button',{name:'New Symbol'}).click();
  await page.getByRole('textbox',{name:'Symbol name'}).fill('Port Based Switch');
  await page.getByRole('textbox',{name:'Symbol name'}).press('Tab');
  await page.getByRole('button',{name:'Connection Port Tool'}).click();
  const svg=page.locator('svg.studio-svg'),box=await svg.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x+box!.width*.5,box!.y+box!.height*.2);
  await expect(page.locator('[data-port-id=P1]')).toBeVisible();
  await page.locator('input[aria-label="Rename port P1"]').fill('TerminalTop');
  await page.locator('input[aria-label="Rename port P1"]').press('Tab');
  await expect(page.locator('[data-port-id=TerminalTop]')).toBeVisible();
  const before=await page.locator('[data-port-id=TerminalTop] circle').first().getAttribute('cx');
  const point=await page.locator('[data-port-id=TerminalTop] circle').first().boundingBox();
  expect(point).not.toBeNull();
  await page.mouse.move(point!.x+point!.width/2,point!.y+point!.height/2);
  await page.mouse.down();
  await page.mouse.move(point!.x+point!.width/2+45,point!.y+point!.height/2+15,{steps:8});
  await page.mouse.up();
  await expect(page.locator('[data-port-id=TerminalTop] circle').first()).not.toHaveAttribute('cx',before!);
  await page.getByRole('button',{name:'Undo Symbol Studio'}).click();
  await expect(page.locator('[data-port-id=TerminalTop] circle').first()).toHaveAttribute('cx',before!);
  await page.getByRole('button',{name:'Save Symbol Studio'}).click();
  await page.getByRole('button',{name:'Back to HMI Editor'}).click();
  await page.getByRole('button',{name:'Add V2 Port Based Switch'}).click();
  await expect(page.locator('g.canvas-node').last().locator('[data-vector-port=TerminalTop]')).toHaveCount(1);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'⇩ Export',exact:true}).click();
  const file=await download,stream=await file.createReadStream();let text='';
  for await(const chunk of stream)text+=chunk.toString();
  const project=JSON.parse(text);
  expect(project.vectorSymbols[0].ports.TerminalTop).toHaveLength(2);
  expect(project.vectorSymbols[0].name).toBe('Port Based Switch');
});

test('Pivot tool: moving blade rotation hinge changes OPEN pose but preserves BASE line geometry',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  const original=page.locator('[data-node-id=blade] line').first();
  await expect(original).toHaveAttribute('x1','50');
  await page.getByRole('button',{name:'Pivot Tool'}).click();
  // Pivot edits target the selected graphic, not the complete symbol.
  await page.getByRole('button',{name:'Select blade'}).click();
  await expect(page.locator('.studio-properties strong')).toHaveText('blade');
  await expect(page.getByTestId('pivot-handle')).toBeVisible();
  const handle=await page.getByTestId('pivot-handle').boundingBox();
  expect(handle).not.toBeNull();
  const x=handle!.x+handle!.width/2,y=handle!.y+handle!.height/2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+12,y+52,{steps:8});
  await page.mouse.up();
  await expect(page.getByRole('spinbutton',{name:'Pivot Y'})).not.toHaveValue('35');
  await expect(original).toHaveAttribute('x1','50');
  await page.getByRole('button',{name:'Edit state Open'}).click();
  // Angular state rendering can settle one frame after the state button click.
  // Assert the actual OPEN blade rotation with Playwright's retrying assertion.
  await expect(page.getByRole('spinbutton',{name:'Studio rotation'})).toHaveValue('-60');
  const moved=page.locator('[data-node-id=blade]').getAttribute('transform');
  const pos=await moved;
  await page.getByRole('button',{name:'Undo Symbol Studio'}).click();
  // Undo after changing preview state must restore the base pivot only.
  await page.getByRole('button',{name:'Base',exact:false}).click();
  await expect(page.getByRole('spinbutton',{name:'Pivot Y'})).toHaveValue('35');
  await page.getByRole('button',{name:'Edit state Open'}).click();
  expect(await page.locator('[data-node-id=blade]').getAttribute('transform')).not.toBe(pos);
});
