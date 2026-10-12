import {test,expect} from '@playwright/test';

test('CB rotating responds to IEC double-point with distinct visual states and safe quality',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Add dynamic CB Rotating'}).click();
  const cb=page.locator('g.canvas-node').last();
  await expect(cb.locator('svg.dynamic-symbol')).toBeVisible();
  await page.getByLabel('Tag identifier').fill('BayA/XCBR1.Pos.stVal');
  await page.getByLabel('Tag identifier').press('Tab');
  await expect(page.getByRole('combobox',{name:'Position encoding'})).toHaveValue('double-point');
  await page.getByRole('button',{name:/Preview/}).click();
  for(const [value,state] of [['0','INTERMEDIATE'],['1','OPEN'],['2','CLOSED'],['3','BAD_STATE']]){
    await page.getByRole('spinbutton',{name:'Simulated numeric value'}).fill(value);
    await page.getByRole('spinbutton',{name:'Simulated numeric value'}).press('Tab');
    await expect(cb).toHaveAttribute('data-dynamic-state',state);
  }
  await page.getByRole('combobox',{name:'Simulation quality'}).selectOption('BAD');
  await expect(cb).toHaveAttribute('data-visual-status','BAD');
  await expect(cb).toHaveAttribute('data-dynamic-state','BAD_STATE');
});

test('custom vector symbol composes, is reusable, and travels with project JSON',async({page})=>{
  await page.goto('/');
  const addLine=page.locator('.palette button').filter({hasText:'Line'});
  await expect(addLine).toHaveCount(1);
  await addLine.click();
  await addLine.click();
  await expect(page.locator('g.canvas-node')).toHaveCount(13);
  const lineLayers=page.locator('.layers button').filter({hasText:'Line'});
  await expect(lineLayers).toHaveCount(2);
  await lineLayers.first().click();
  await lineLayers.last().click({modifiers:['Shift']});
  await expect(page.getByText('2 objects selected.')).toBeVisible();
  await page.getByRole('button',{name:'Create Dynamic Symbol from Lines'}).click();
  await expect(page.getByTestId('symbol-builder')).toBeVisible();
  await page.getByRole('textbox',{name:'Dynamic symbol name'}).fill('Bay Custom CB');
  await page.getByRole('button',{name:'Save to My Symbols'}).click();
  await expect(page.getByTestId('symbol-builder')).toHaveCount(0);
  await page.getByRole('button',{name:'Add custom Bay Custom CB'}).click();
  const custom=page.locator('g.canvas-node').last();
  await expect(custom.locator('svg.dynamic-symbol')).toBeVisible();
  await page.getByLabel('Tag identifier').fill('Bay/CB');
  await page.getByLabel('Tag identifier').press('Tab');
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'⇩ Export'}).click();
  const result=await download;
  const stream=await result.createReadStream();let body='';
  for await(const chunk of stream)body+=chunk.toString();
  const project=JSON.parse(body);
  expect(project.customSymbols).toHaveLength(1);
  expect(project.customSymbols[0].format).toBe('web-hmi-symbol');
  expect(project.pages[0].shapes.at(-1).symbolId).toBe(project.customSymbols[0].id);
});
