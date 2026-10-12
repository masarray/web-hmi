import {test,expect} from '@playwright/test';
const SECRET='cp14-operator-admin-token-32chars-abcdefg';
const initialRule={id:'motorHigh',label:'Motor high load',tagId:'PLC1/Motor/Load',
 condition:'above',threshold:80,hysteresis:5,severity:'critical'};
test('CP14 operator sees active alarm, acknowledges it, then checks event history',async({page})=>{
 let acked=false;
 await page.route('**/api/alarms**',async route=>{
  const req=route.request();
  expect(req.headers()['authorization']).toBe('Bearer '+SECRET);
  const isAck=req.url().endsWith('/ack');
  if(isAck){acked=true;expect(req.postDataJSON()).toEqual({id:'motorHigh'});}
  const snap={revision:3,rules:[initialRule],active:[{
    id:'motorHigh',label:'Motor high load',tagId:'PLC1/Motor/Load',
    severity:'critical',phase:'ACTIVE',acknowledged:acked,since:10000,lastValue:92
   }],recent:acked?[{
    id:2,time:11000,ruleId:'motorHigh',label:'Motor high load',
    tagId:'PLC1/Motor/Load',severity:'critical',type:'ACK',value:92
   },{
    id:1,time:10000,ruleId:'motorHigh',label:'Motor high load',
    tagId:'PLC1/Motor/Load',severity:'critical',type:'ACTIVE',value:92
   }]:[],unacknowledged:acked?0:1,storageError:null};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snap)});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Open alarms'}).click();
 const panel=page.getByTestId('alarm-center');
 await expect(panel).toBeVisible();
 await page.getByRole('textbox',{name:'Alarm server token'}).fill(SECRET);
 await page.getByRole('button',{name:'Connect'}).click();
 await expect(panel).toContainText('Motor high load');
 await expect(panel).toContainText('1 need attention');
 await page.getByRole('button',{name:'Acknowledge Motor high load'}).click();
 await expect(panel).toContainText('Acknowledged');
 await page.getByRole('button',{name:'Event history'}).click();
 await expect(panel.getByLabel('Recent alarm events')).toContainText('ACK');
});
test('CP14 engineer creates a threshold alarm with simple rule editor',async({page})=>{
 let revision=0,rules:any[]=[];
 await page.route('**/api/alarms**',async route=>{
  const request=route.request();
  if(request.url().endsWith('/config')){
   const body=request.postDataJSON();
   expect(body.revision).toBe(revision);
   revision++;
   rules=body.rules;
  }
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
   revision,rules,active:[],recent:[],unacknowledged:0,storageError:null
  })});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Open alarms'}).click();
 await page.getByRole('textbox',{name:'Alarm server token'}).fill(SECRET);
 await page.getByRole('button',{name:'Connect'}).click();
 await page.getByText('Configure alarm rules').click();
 await page.getByRole('button',{name:'Add rule'}).click();
 await page.getByRole('textbox',{name:'Alarm label 1'}).fill('Pressure high');
 await page.getByRole('textbox',{name:'Alarm label 1'}).press('Tab');
 await page.getByRole('spinbutton',{name:'Alarm threshold 1'}).fill('90');
 await page.getByRole('spinbutton',{name:'Alarm threshold 1'}).press('Tab');
 await page.getByRole('button',{name:'Save alarm rules'}).click();
 await expect(page.getByTestId('alarm-center')).toContainText('Alarm rules saved');
 expect(rules.length).toBe(1);
 expect(rules[0].label).toBe('Pressure high');
 expect(rules[0].threshold).toBe(90);
});
