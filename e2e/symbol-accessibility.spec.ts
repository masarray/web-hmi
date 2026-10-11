import {test,expect} from '@playwright/test';

test('full catalog remains discoverable without search knowledge',async({page})=>{
  await page.goto('/');
  const cards=page.locator('.symbol-gallery .symbol-card');
  await expect(cards).toHaveCount(24);
  await page.getByRole('button',{name:/Show more symbols/}).click();
  await expect(cards).toHaveCount(36);
  await page.getByRole('combobox',{name:'Symbol category'}).selectOption('Pumps');
  await expect(page.getByRole('button',{name:/Show more symbols/})).toHaveCount(0);
  await expect(cards).toHaveCount(7);
});
test('process outline inspector only displays meaningful color controls',async({page})=>{
  await page.goto('/');
  await page.getByRole('searchbox',{name:'Search symbols'}).fill('pumpgear');
  await page.getByRole('button',{name:'Add Pumpgear SVG symbol'}).click();
  await expect(page.getByLabel('Stroke',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Fill',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Editable vector geometry: 4 SVG parts.')).toBeVisible();
});
