import {test,expect} from '@playwright/test';

test('CP10 novice configures remote PLC mapping visually and preserves it',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 const panel=page.getByTestId('mapping-editor');
 await expect(panel).toBeVisible();
 await expect(panel.getByText(/Valid: 1 tags/)).toBeVisible();
 await page.getByRole('textbox',{name:'Modbus device host'}).fill('192.168.1.10');
 await page.getByRole('textbox',{name:'Modbus device host'}).press('Tab');
 await expect(page.getByRole('textbox',{name:'Modbus device host'})).toHaveValue('192.168.1.10');
 await page.getByRole('button',{name:'＋ Add tag'}).click();
 await expect(panel.locator('tbody tr')).toHaveCount(2);
 await page.getByRole('textbox',{name:'Tag ID row 2'}).fill('Feeder/Trip');
 await page.getByRole('textbox',{name:'Tag ID row 2'}).press('Tab');
 await page.getByRole('combobox',{name:'Memory area row 2'}).selectOption('2');
 await expect(page.getByRole('combobox',{name:'Data type row 2'})).toHaveValue('bool');
 await expect(page.getByRole('combobox',{name:'Word order row 2'})).toBeDisabled();
 await expect(panel.getByText(/Valid: 2 tags/)).toBeVisible();
 await page.reload();
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await expect(page.getByRole('textbox',{name:'Modbus device host'})).toHaveValue('192.168.1.10');
 await expect(page.getByRole('textbox',{name:'Tag ID row 2'})).toHaveValue('Feeder/Trip');
 await page.getByRole('searchbox',{name:'Search mapped tags'}).fill('Trip');
 await expect(panel.locator('tbody tr')).toHaveCount(1);
 await page.getByRole('searchbox',{name:'Search mapped tags'}).fill('');
 const promised=page.waitForEvent('download');
 await page.getByRole('button',{name:'⇩ Export config'}).click();
 const downloaded=await promised;
 const stream=await downloaded.createReadStream();
 let data='';
 for await(const chunk of stream)data+=chunk.toString();
 const json=JSON.parse(data);
 expect(json.host).toBe('192.168.1.10');
 expect(json.tags[1].tagId).toBe('Feeder/Trip');
 expect(json.tags[1].functionCode).toBe(2);
 expect(json.tags[1].dataType).toBe('bool');
});
test('CP10 mapping validation prevents export and inspector offers configured tags',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 await page.getByRole('textbox',{name:'Modbus device host'}).fill('http://bad-host');
 await page.getByRole('textbox',{name:'Modbus device host'}).press('Tab');
 await expect(page.getByRole('button',{name:'⇩ Export config'})).toBeDisabled();
 await expect(page.getByText(/Check mapping: Invalid Modbus device/)).toBeVisible();
 await page.getByRole('textbox',{name:'Modbus device host'}).fill('10.1.2.3');
 await page.getByRole('textbox',{name:'Modbus device host'}).press('Tab');
 await expect(page.getByRole('button',{name:'⇩ Export config'})).toBeEnabled();
 await page.getByRole('button',{name:'Close device mapper'}).click();
 await page.getByRole('searchbox',{name:'Search symbols'}).fill('motor');
 await page.getByRole('button',{name:'Add Motor Simb SVG symbol'}).click();
 const tagPicker=page.getByRole('combobox',{name:'Choose mapped device tag'});
 await expect(tagPicker).toBeVisible();
 await tagPicker.selectOption('Plant/Motor');
 await expect(page.getByLabel('Tag identifier')).toHaveValue('Plant/Motor');
});
test('CP10 imports file, rejects malicious mapping without changing valid draft',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Configure Modbus tags'}).click();
 const upload=page.locator('[data-testid="mapping-editor"] input[type=file]');
 const good={host:'plc.industrial.local',port:1502,unitId:8,pollMs:750,
   requestTimeoutMs:650,tags:[{tagId:'Power/Value',functionCode:4,
   address:12,dataType:'float32',wordOrder:'CDAB'}]};
 await upload.setInputFiles({name:'device.json',mimeType:'application/json',
   buffer:Buffer.from(JSON.stringify(good))});
 await expect(page.getByRole('textbox',{name:'Modbus device host'})).toHaveValue('plc.industrial.local');
 await expect(page.getByRole('textbox',{name:'Tag ID row 1'})).toHaveValue('Power/Value');
 await upload.setInputFiles({name:'invalid.json',mimeType:'application/json',
   buffer:Buffer.from(JSON.stringify({...good,tags:[{...good.tags[0],address:65535}]}))});
 await expect(page.getByText(/Import rejected:/)).toBeVisible();
 await expect(page.getByRole('textbox',{name:'Tag ID row 1'})).toHaveValue('Power/Value');
 await expect(page.getByRole('textbox',{name:'Modbus device host'})).toHaveValue('plc.industrial.local');
});
