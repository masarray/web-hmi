import {test,expect} from '@playwright/test';
const TOKEN='cp15-browser-trend-admin-token-32chars';
const recorded='PLC1/Plant/Motor';
test('CP15 engineer configures and views historian from one simple panel',async({page})=>{
 let config={tags:[] as string[],sampleMs:2000,retentionDays:3},revision=0;
 let queries=0;
 await page.route('**/api/trends**',async route=>{
  const req=route.request(),url=req.url();
  expect(req.headers()['authorization']).toBe('Bearer '+TOKEN);
  if(url.endsWith('/config')){
   const payload=req.postDataJSON();
   expect(payload.revision).toBe(revision);
   config={tags:payload.tags,sampleMs:payload.sampleMs,retentionDays:payload.retentionDays};
   revision++;
  }
  if(url.endsWith('/query')){
   queries++;
   const p=req.postDataJSON();
   const sample=(t:number,v:number)=>({t,tagId:recorded,v,q:'GOOD'});
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    from:p.from,to:p.to,scanned:2,series:[{tagId:recorded,points:[
      sample(p.from+10000,20),sample(p.to-10000,65)
    ]}]
   })});return;
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    revision,config,recorded:2,queued:0,lastSavedAt:null,storageError:null
  })});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Open trends'}).click();
 const panel=page.getByTestId('trend-center');
 await expect(panel).toBeVisible();
 await expect(panel.getByText('Connect', {exact:true})).toBeVisible();
 await page.getByRole('textbox',{name:'Trend server token'}).fill(TOKEN);
 await page.getByRole('button',{name:'Connect'}).click();
 await page.getByText('Recording settings').click();
 await page.getByRole('textbox',{name:'Trend tag ID'}).fill(recorded);
 await page.getByRole('button',{name:'Add tag'}).click();
 await page.getByRole('button',{name:'Save recording'}).click();
 await expect(panel).toContainText('Recording settings saved');
 await page.getByRole('button',{name:'Refresh chart'}).click();
 await expect(panel.getByRole('img',{name:'Historical PLC tag trend chart'})).toBeVisible();
 await expect(panel.locator('.trend-plot path[stroke="#65d4ec"]')).toHaveAttribute('d',/^M/);
 expect(queries).toBe(1);
 await page.reload();
 await page.getByRole('button',{name:'Open trends'}).click();
 await expect(page.getByRole('textbox',{name:'Trend server token'})).toHaveValue('');
});
test('CP15 unavailable historian gives simple feedback and never changes PLC mapping',async({page})=>{
 await page.route('**/api/trends',async route=>{
  await route.fulfill({status:503,contentType:'application/json',
   body:'{"error":"Historian storage unavailable"}'});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Open trends'}).click();
 await page.getByRole('textbox',{name:'Trend server token'}).fill(TOKEN);
 await page.getByRole('button',{name:'Connect'}).click();
 await expect(page.getByTestId('trend-center')).toContainText('Historian storage unavailable');
 await page.getByRole('button',{name:'Close trends'}).click();
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await expect(page.getByRole('textbox',{name:'Modbus device host'})).toBeVisible();
});
