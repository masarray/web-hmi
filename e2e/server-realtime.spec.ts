import {test,expect} from '@playwright/test';

test('Node tag server controls preview quality and active state; local simulator stays separate',async({page})=>{
 await page.goto('/');
 await page.getByRole('searchbox',{name:'Search symbols'}).fill('motor');
 await page.getByRole('button',{name:'Add Motor Simb SVG symbol'}).click();
 await page.getByRole('combobox',{name:'Symbol animation'}).selectOption('spin');
 await page.getByLabel('Tag identifier').fill('Plant/Motor');
 await page.getByLabel('Tag identifier').press('Tab');
 const motor=page.locator('g.canvas-node').last();
 await page.getByRole('button',{name:/Preview/}).click();
 await expect(page.getByTestId('simulation-bar')).toContainText('SIMULATION ONLY');
 await page.getByRole('combobox',{name:'Preview data source'}).selectOption('server');
 await expect(page.getByTestId('simulation-bar')).toContainText('SERVER DEMO');
 await expect(page.getByTestId('stream-status')).toHaveAttribute('data-state','connected');
 await expect(motor).toHaveAttribute('data-visual-quality','GOOD',{timeout:12000});
 await expect.poll(async()=>motor.getAttribute('data-visual-status'),{timeout:12000})
  .toMatch(/ACTIVE|IDLE/);
 await page.getByRole('combobox',{name:'Preview data source'}).selectOption('local');
 await expect(page.getByTestId('stream-status')).toHaveCount(0);
 await expect(motor).toHaveAttribute('data-visual-quality','STALE');
 await page.getByRole('button',{name:'Set ON'}).click();
 await expect(motor).toHaveAttribute('data-visual-status','ACTIVE');
 await page.getByRole('combobox',{name:'Preview data source'}).selectOption('server');
 await expect(page.getByTestId('stream-status')).toHaveAttribute('data-state','connected');
 await expect(motor).toHaveAttribute('data-visual-quality','GOOD',{timeout:12000});
});

test('unknown server tags fail closed and never claim live equipment connection',async({page})=>{
 await page.goto('/');
 await page.getByRole('searchbox',{name:'Search symbols'}).fill('motor');
 await page.getByRole('button',{name:'Add Motor Simb SVG symbol'}).click();
 await page.getByRole('combobox',{name:'Symbol animation'}).selectOption('spin');
 await page.getByLabel('Tag identifier').fill('Unknown/Disconnected');
 await page.getByLabel('Tag identifier').press('Tab');
 await page.getByRole('button',{name:/Preview/}).click();
 await page.getByRole('combobox',{name:'Preview data source'}).selectOption('server');
 await expect(page.getByTestId('stream-status')).toHaveAttribute('data-state','connected');
 const motor=page.locator('g.canvas-node').last();
 await expect(motor).toHaveAttribute('data-visual-quality','STALE');
 await expect(motor.locator('g.process-rotor')).toHaveCount(0);
 await expect(page.getByTestId('simulation-bar')).toContainText('READ ONLY');
 await expect(page.locator('.canvas-footer')).toContainText('NO INDUSTRIAL DEVICES');
});
