import {test,expect} from '@playwright/test';
const KEY='cp13-multi-plc-admin-token-32-characters';

test('CP13 beginner adds two PLCs, binds unique tag names and applies both together',async({page})=>{
 let revision=0;
 let applied:any=null;
 await page.route('**/api/fleet**',async route=>{
  const request=route.request(),url=request.url();
  if(request.headers()['authorization']!=='Bearer '+KEY){
   await route.fulfill({status:401,contentType:'application/json',body:'{"error":"Authorization required"}'});
   return;
  }
  if(url.endsWith('/apply')){
   applied=request.postDataJSON();
   revision++;
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    revision,busy:false,ok:true,devices:applied.devices.map((d:any)=>({...d,health:'HEALTHY',diagnostics:null}))
   })});
  }else if(url.endsWith('/test')){
   await route.fulfill({status:200,contentType:'application/json',
    body:'{"ok":true,"latencyMs":22,"readRequests":1}'});
  }else{
   await route.fulfill({status:200,contentType:'application/json',
    body:JSON.stringify({revision,busy:false,devices:[]})});
  }
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await page.getByRole('button',{name:'Multiple PLCs'}).click();
 const manager=page.getByTestId('fleet-manager');
 await expect(manager).toBeVisible();
 await page.getByRole('button',{name:'Add PLC'}).click();
 await expect(manager.locator('.fleet-devices button')).toHaveCount(3);
 await page.getByRole('textbox',{name:'Selected PLC name'}).fill('Tank PLC');
 await page.getByRole('textbox',{name:'Selected PLC name'}).press('Tab');
 await page.getByRole('textbox',{name:'Modbus device host'}).fill('10.20.30.40');
 await page.getByRole('textbox',{name:'Modbus device host'}).press('Tab');
 await page.getByRole('textbox',{name:'Fleet server token'}).fill(KEY);
 await page.getByRole('button',{name:'Load from server'}).click();
 await page.getByRole('button',{name:'Apply all PLCs'}).click();
 await expect(manager).toContainText('Saved on server · 2 PLCs');
 expect(applied.revision).toBe(0);
 expect(applied.devices.map((d:any)=>d.id)).toEqual(['PLC1','PLC2']);
 expect(applied.devices[0].config.tags[0].tagId).toBe('Plant/Motor');
 expect(applied.devices[1].config.host).toBe('10.20.30.40');
 await page.getByRole('button',{name:'Close device mapper'}).click();
 await page.getByRole('searchbox',{name:'Search symbols'}).fill('motor');
 await page.getByRole('button',{name:'Add Motor Simb SVG symbol'}).click();
 const selector=page.getByRole('combobox',{name:'Choose mapped device tag'});
 await selector.selectOption('PLC2/Plant/Motor');
 await expect(page.getByLabel('Tag identifier')).toHaveValue('PLC2/Plant/Motor');
});
test('CP13 failed server validation leaves local PLC list untouched',async({page})=>{
 await page.route('**/api/fleet**',async route=>{
  if(route.request().method()==='GET'){
   await route.fulfill({status:200,contentType:'application/json',body:
    '{"revision":0,"busy":false,"devices":[]}'});
  }else{
   await route.fulfill({status:400,contentType:'application/json',
    body:'{"error":"PLC refused request"}'});
  }
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await page.getByRole('button',{name:'Multiple PLCs'}).click();
 await page.getByRole('button',{name:'Add PLC'}).click();
 await page.getByRole('textbox',{name:'Fleet server token'}).fill(KEY);
 await page.getByRole('button',{name:'Load from server'}).click();
 await page.getByRole('button',{name:'Apply all PLCs'}).click();
 await expect(page.getByTestId('fleet-manager')).toContainText('No changes applied:');
 await expect(page.getByRole('textbox',{name:'Selected PLC name'})).toHaveValue('PLC 2');
 await expect(page.getByRole('button',{name:'Apply all PLCs'})).toBeDisabled();
});
