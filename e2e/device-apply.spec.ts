import {test,expect} from '@playwright/test';
const TOKEN='playwright-admin-token-configuration-test-32chars';
test('CP11 authenticated apply from mapping GUI updates revision and runtime feedback',async({page})=>{
 let revision=0, applied:any=null;
 await page.route('**/api/device/**',async route=>{
  const request=route.request();
  const auth=request.headers()['authorization'];
  if(auth!=='Bearer '+TOKEN){
   await route.fulfill({status:401,contentType:'application/json',
    body:JSON.stringify({error:'Administrator authorization required'})});return;
  }
  if(request.url().endsWith('/status')){
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({revision,health:revision?'HEALTHY':'UNCONFIGURED',
      configured:revision>0})});return;
  }
  applied=request.postDataJSON();
  if(applied.revision!==revision){
   await route.fulfill({status:409,contentType:'application/json',
    body:JSON.stringify({error:'Configuration revision conflict'})});return;
  }
  revision++;
  await route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({ok:true,revision,health:'CONNECTING',configured:true})});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await expect(page.getByRole('button',{name:'Apply to server'})).toBeDisabled();
 await page.getByRole('textbox',{name:'Server admin token'}).fill(TOKEN);
 await page.getByRole('button',{name:'Check server'}).click();
 await expect(page.getByTestId('device-runtime-health')).toContainText('Revision 0');
 await page.getByRole('textbox',{name:'Modbus device host'}).fill('10.10.1.5');
 await page.getByRole('textbox',{name:'Modbus device host'}).press('Tab');
 await page.getByRole('button',{name:'Apply to server'}).click();
 await expect(page.getByText(/Configuration applied · revision 1/)).toBeVisible();
 expect(applied.config.host).toBe('10.10.1.5');
 expect(applied.config.tags[0].tagId).toBe('Plant/Motor');
 await expect(page.getByTestId('device-runtime-health')).toContainText('Revision 1');
 await page.reload();
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await expect(page.getByRole('textbox',{name:'Server admin token'})).toHaveValue('');
 await expect(page.getByRole('button',{name:'Apply to server'})).toBeDisabled();
});
test('CP11 rejected apply keeps mapping draft and requires explicit status refresh',async({page})=>{
 await page.route('**/api/device/**',async route=>{
  if(route.request().url().endsWith('/status')){
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({revision:3,health:'HEALTHY',configured:true})});
  }else{
   await route.fulfill({status:409,contentType:'application/json',
    body:JSON.stringify({error:'Configuration revision conflict'})});
  }
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await page.getByRole('textbox',{name:'Server admin token'}).fill(TOKEN);
 await page.getByRole('button',{name:'Check server'}).click();
 await page.getByRole('textbox',{name:'Modbus device host'}).fill('plc.example.local');
 await page.getByRole('textbox',{name:'Modbus device host'}).press('Tab');
 await page.getByRole('button',{name:'Apply to server'}).click();
 await expect(page.getByText(/Apply failed; previous source retained/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Apply to server'})).toBeDisabled();
 await expect(page.getByRole('textbox',{name:'Modbus device host'})).toHaveValue('plc.example.local');
});
