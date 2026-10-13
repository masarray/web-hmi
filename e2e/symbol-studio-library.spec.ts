import {test,expect} from '@playwright/test';

test('Symbol Studio Save flows into HMI library, drag-ready instance, bound tag and state preview',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  await page.getByRole('button',{name:'New Symbol'}).click();
  await page.getByRole('textbox',{name:'Symbol name'}).fill('Test V2 Switch');
  await page.getByRole('textbox',{name:'Symbol name'}).press('Tab');
  await page.getByRole('button',{name:'Edit state Closed'}).click();
  await page.locator('input[aria-label="Studio stroke color"]').fill('#44cc88');
  await page.locator('input[aria-label="Studio stroke color"]').dispatchEvent('change');
  await page.getByRole('button',{name:'Save Symbol Studio'}).click();
  const saved=await page.evaluate(()=>{
    const raw=localStorage.getItem('web-hmi.project.v1');
    const p=raw?JSON.parse(raw):null;
    return {catalog:p?.vectorSymbols?.map((x:{id:string;name:string})=>x.name)??[],
      hasProject:!!p,studio:!!localStorage.getItem('web-hmi.symbol-studio.v2')};
  });
  console.log('V2_LIBRARY_DIAGNOSTIC',JSON.stringify(saved));
  await page.getByRole('button',{name:'Back to HMI Editor'}).click();
  const library=page.getByRole('button',{name:'Add V2 Test V2 Switch'});
  await expect(library).toBeVisible();
  await library.click();
  const shape=page.locator('g.canvas-node').last();
  await expect(shape.locator('svg[data-vector-symbol-id]')).toBeVisible();
  await page.getByLabel('Tag identifier').fill('BayA/XCBR1.Pos.stVal');
  await page.getByLabel('Tag identifier').press('Tab');
  await page.getByRole('button',{name:/Preview/}).click();
  const number=page.getByRole('spinbutton',{name:'Simulated numeric value'});
  await number.fill('2');await number.press('Tab');
  await expect(shape).toHaveAttribute('data-vector-state','CLOSED');
  await expect(shape.locator('[data-vector-part=starter-line] line')).toHaveAttribute('stroke','#44cc88');
  await number.fill('1');await number.press('Tab');
  await expect(shape).toHaveAttribute('data-vector-state','OPEN');
  await expect(shape.locator('[data-vector-part=starter-line] line')).not.toHaveAttribute('stroke','#44cc88');
  await page.getByRole('combobox',{name:'Simulation quality'}).selectOption('BAD');
  await expect(shape).toHaveAttribute('data-vector-state','BAD_STATE');
  await expect(shape).toHaveAttribute('data-visual-status','BAD');
  await expect(shape.locator('g.visual-quality-indicator')).toBeVisible();
});

test('editing a placed V2 symbol updates definition once and preserves instance tag',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  await page.getByRole('button',{name:'New Symbol'}).click();
  await page.getByRole('textbox',{name:'Symbol name'}).fill('Editable V2 Switch');
  await page.getByRole('textbox',{name:'Symbol name'}).press('Tab');
  await page.getByRole('button',{name:'Save Symbol Studio'}).click();
  const saved=await page.evaluate(()=>{
    const raw=localStorage.getItem('web-hmi.project.v1');
    const p=raw?JSON.parse(raw):null;
    return {catalog:p?.vectorSymbols?.map((x:{id:string;name:string})=>x.name)??[],
      hasProject:!!p,studio:!!localStorage.getItem('web-hmi.symbol-studio.v2')};
  });
  console.log('V2_LIBRARY_DIAGNOSTIC',JSON.stringify(saved));
  await page.getByRole('button',{name:'Back to HMI Editor'}).click();
  await page.getByRole('button',{name:'Add V2 Editable V2 Switch'}).click();
  await page.getByLabel('Tag identifier').fill('BayA/XCBR1.Pos.stVal');
  await page.getByLabel('Tag identifier').press('Tab');
  await page.getByRole('button',{name:'Edit V2 in Symbol Studio'}).click();
  await expect(page.getByRole('textbox',{name:'Symbol name'})).toHaveValue('Editable V2 Switch');
  await page.getByRole('button',{name:'Edit state Open'}).click();
  await page.locator('input[aria-label="Studio stroke color"]').fill('#dfab44');
  await page.locator('input[aria-label="Studio stroke color"]').dispatchEvent('change');
  await page.getByRole('button',{name:'Save Symbol Studio'}).click();
  await page.getByRole('button',{name:'Back to HMI Editor'}).click();
  await expect(page.getByLabel('Tag identifier')).toHaveValue('BayA/XCBR1.Pos.stVal');
  const shape=page.locator('g.canvas-node').last();
  await expect(shape.locator('[data-vector-part=starter-line] line')).toHaveAttribute('stroke','#dfab44');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'⇩ Export',exact:true}).click();
  const file=await download;
  const stream=await file.createReadStream();let body='';
  for await(const buf of stream)body+=buf.toString();
  const project=JSON.parse(body);
  expect(project.vectorSymbols).toHaveLength(1);
  expect(project.pages[0].shapes.at(-1).symbolId).toBe(project.vectorSymbols[0].id);
  expect(project.pages[0].shapes.at(-1).tagId).toBe('BayA/XCBR1.Pos.stVal');
  const open=project.vectorSymbols[0].states.find((state:{id:string})=>state.id==='OPEN');
  expect(open.overrides['starter-line'].style.stroke).toBe('#dfab44');
});
