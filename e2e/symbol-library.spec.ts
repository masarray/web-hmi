import {test,expect} from '@playwright/test';

test('vector library is searchable, categorized and renders from local SVG assets',async({page})=>{
  await page.goto('/');
  const search=page.getByRole('searchbox',{name:'Search symbols'});
  await expect(page.getByText('INDUSTRIAL SVG LIBRARY')).toBeVisible();
  await search.fill('centrifugal');
  const add=page.getByRole('button',{name:'Add Centrifugal Pump SVG symbol'});
  await expect(add).toBeVisible();
  const thumb=add.locator('img');
  await expect.poll(()=>thumb.evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  const count=await page.locator('g.canvas-node').count();
  await add.click();
  await expect(page.locator('g.canvas-node')).toHaveCount(count+1);
  const last=page.locator('g.canvas-node').last();
  await expect(last.locator('image.svg-library-symbol')).toHaveAttribute('href','assets/fuxa/pumpcentri1.svg');
  await expect(page.getByRole('combobox',{name:'Symbol animation'})).toBeVisible();
  await page.screenshot({path:'test-results/fuxa-symbol-library.png',fullPage:true});
});

test('symbol animation runs only in preview and survives reload',async({page})=>{
  await page.goto('/');
  await page.getByRole('searchbox',{name:'Search symbols'}).fill('compressor fan');
  await page.getByRole('button',{name:'Add Compressor Fan SVG symbol'}).click();
  const mode=page.getByRole('combobox',{name:'Symbol animation'});
  await mode.selectOption('spin');
  const icon=page.locator('g.canvas-node').last().locator('image.svg-library-symbol');
  await expect(icon).not.toHaveClass(/symbol-spin/);
  await page.getByRole('button',{name:/Preview/}).click();
  await expect(icon).toHaveClass(/symbol-spin/);
  await expect.poll(()=>icon.evaluate(el=>getComputedStyle(el).animationName)).toMatch(/hmi-symbol-spin$/);
  await page.getByRole('button',{name:/Exit Preview/}).click();
  await page.reload();
  await page.getByRole('searchbox',{name:'Search symbols'}).fill('compressor fan');
  const last=page.locator('g.canvas-node').last();
  await last.click();
  await expect(page.getByRole('combobox',{name:'Symbol animation'})).toHaveValue('spin');
});

test('category filters and draggable SVG assets work',async({page})=>{
  await page.goto('/');
  await page.getByRole('combobox',{name:'Symbol category'}).selectOption('Valves & Pipes');
  await expect(page.getByRole('button',{name:'Add Valve Ax SVG symbol'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add Compressor Fan SVG symbol'})).toHaveCount(0);
  const count=await page.locator('g.canvas-node').count();
  await page.getByRole('button',{name:'Add Valve Ax SVG symbol'}).dragTo(page.locator('svg.viewport'),{
    targetPosition:{x:250,y:220}
  });
  await expect(page.locator('g.canvas-node')).toHaveCount(count+1);
  await expect(page.locator('g.canvas-node').last().locator('image')).toHaveAttribute('href','assets/fuxa/valve-ax.svg');
});
