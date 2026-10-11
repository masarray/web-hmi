import {test,expect} from '@playwright/test';
test('editor add edit undo redo reload and export',async({page})=>{
  await page.goto('/');
  await expect(page.getByText('132 kV SWITCHYARD')).toBeVisible();
  const shapes=page.locator('g.canvas-node');
  const initial=await shapes.count();
  await page.getByRole('button',{name:/Rectangle/}).click();
  await expect(shapes).toHaveCount(initial+1);
  await page.getByLabel('Object name').fill('My Test Rectangle');
  await page.getByLabel('Object name').press('Tab');
  await expect(page.getByRole('button',{name:/My Test Rectangle/})).toBeVisible();
  await page.getByRole('button',{name:/Undo/}).click();
  await expect(page.getByRole('button',{name:/My Test Rectangle/})).toHaveCount(0);
  await page.getByRole('button',{name:/Redo/}).click();
  await expect(page.getByRole('button',{name:/My Test Rectangle/})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button',{name:/My Test Rectangle/})).toBeVisible();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:/Export/}).click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('web-hmi-project.json');
  await page.screenshot({path:'test-results/editor-smoke.png',fullPage:true});
});
test('drag object and reject invalid JSON import',async({page})=>{
  await page.goto('/');
  const node=page.locator('g.canvas-node').nth(5);
  const before=await node.getAttribute('transform');
  const rect=await node.boundingBox();
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x+rect!.width/2,rect!.y+rect!.height/2);
  await page.mouse.down();
  await page.mouse.move(rect!.x+rect!.width/2+60,rect!.y+rect!.height/2+40,{steps:5});
  await page.mouse.up();
  await expect(node).not.toHaveAttribute('transform',before!);
  await page.locator('input[type=file]').setInputFiles({
    name:'invalid.json',mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify({schemaVersion:999,pages:[]}))
  });
  await expect(page.getByText(/Import rejected:/)).toBeVisible();
  await expect(page.getByText('132 kV SWITCHYARD')).toBeVisible();
});
