import {test,expect} from '@playwright/test';
const KEY='cp12-browser-operator-admin-credentials-32-plus-characters';

test('Test PLC succeeds from a single simple button without applying changes',async({page})=>{
 let tests=0,applies=0;
 await page.route('**/api/device/**',async route=>{
  const path=route.request().url();
  if(path.endsWith('/test')){
   tests++;
   expect(route.request().headers()['authorization']).toBe('Bearer '+KEY);
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({ok:true,latencyMs:34,readRequests:2,host:'10.1.1.25',unitId:1})});
  }else if(path.endsWith('/apply')){
   applies++;
   await route.fulfill({status:409,contentType:'application/json',body:'{"error":"Not expected"}'});
  }else{
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({revision:0,health:'UNCONFIGURED',configured:false})});
  }
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 const panel=page.getByTestId('mapping-editor');
 await page.getByRole('textbox',{name:'Modbus device host'}).fill('10.1.1.25');
 await page.getByRole('textbox',{name:'Modbus device host'}).press('Tab');
 await expect(page.getByRole('button',{name:'Test PLC'})).toBeDisabled();
 await page.getByRole('textbox',{name:'Server admin token'}).fill(KEY);
 await page.getByRole('button',{name:'Test PLC'}).click();
 await expect(page.getByTestId('device-probe')).toContainText('PLC responding · 34 ms · 2 read requests');
 await expect(panel.getByRole('button',{name:'Apply to server'})).toBeDisabled();
 expect(tests).toBe(1);
 expect(applies).toBe(0);
});
test('Device monitoring displays concise live read metrics and faults',async({page})=>{
 const sample={revision:4,health:'HEALTHY',configured:true,diagnostics:{
  successfulReads:31,completedCycles:7,consecutiveFailures:0,
  lastSuccessAt:Date.now(),lastFailureAt:null,lastError:null,lastCycleMs:27
 }};
 await page.route('**/api/device/status',async route=>
  route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(sample)}));
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await page.getByRole('textbox',{name:'Server admin token'}).fill(KEY);
 await page.getByRole('button',{name:'Check server'}).click();
 await expect(page.getByTestId('device-runtime-health')).toContainText('Online');
 const stats=page.getByTestId('device-diagnostics');
 await expect(stats).toContainText('7 successful cycles');
 await expect(stats).toContainText('31 register reads');
 await expect(stats).toContainText('27 ms');
});
test('Failed PLC test keeps active mapping, does not make device status appear connected',async({page})=>{
 await page.route('**/api/device/test',async route=>
  route.fulfill({status:400,contentType:'application/json',
   body:JSON.stringify({error:'Device probe timed out'})}));
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await page.getByRole('textbox',{name:'Server admin token'}).fill(KEY);
 await page.getByRole('button',{name:'Test PLC'}).click();
 await expect(page.getByTestId('device-probe')).toContainText('Device probe timed out');
 await expect(page.getByTestId('device-runtime-health')).toContainText('Not connected');
 await expect(page.getByRole('button',{name:'Apply to server'})).toBeDisabled();
 await expect(page.getByRole('textbox',{name:'Tag ID row 1'})).toHaveValue('Plant/Motor');
});
