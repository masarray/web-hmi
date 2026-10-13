import {test,expect} from '@playwright/test';

async function newGroupedSymbol(page:import('@playwright/test').Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  await page.getByRole('button',{name:'New Symbol'}).click();
  const artboard=page.locator('svg.studio-svg');
  const box=await artboard.boundingBox();
  expect(box).not.toBeNull();
  await page.getByRole('button',{name:'Rectangle Tool'}).click();
  await page.mouse.move(box!.x+box!.width*.62,box!.y+box!.height*.3);
  await page.mouse.down();
  await page.mouse.move(box!.x+box!.width*.78,box!.y+box!.height*.44,{steps:6});
  await page.mouse.up();
  await expect(page.locator('.studio-object rect')).toHaveCount(1);
  await page.getByRole('button',{name:'Select Starter line'}).click();
  await page.getByRole('button',{name:'Select Rect'}).click({modifiers:['Shift']});
  const group=page.getByRole('button',{name:'Group selected elements'});
  await expect(group).toBeEnabled();
  await group.click();
  await expect(page.getByRole('button',{name:'Select Group'})).toBeVisible();
  return artboard;
}

test('native grouping allows double-click isolation and editing individual child per state',async({page})=>{
  await newGroupedSymbol(page);
  await page.getByRole('button',{name:'Select Group'}).dblclick();
  await expect(page.getByTestId('group-isolation')).toBeVisible();
  await page.getByRole('button',{name:'Select Starter line'}).click();
  await expect(page.getByRole('button',{name:'Group selected elements'})).toBeDisabled();
  await page.getByRole('button',{name:'Edit state Open'}).click();
  await page.locator('input[aria-label="Studio stroke color"]').fill('#ff8833');
  await page.locator('input[aria-label="Studio stroke color"]').dispatchEvent('change');
  await page.getByRole('button',{name:'Edit state Closed'}).click();
  await expect(page.locator('input[aria-label="Studio stroke color"]')).not.toHaveValue('#ff8833');
  await page.getByRole('button',{name:'Edit state Open'}).click();
  await expect(page.locator('input[aria-label="Studio stroke color"]')).toHaveValue('#ff8833');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('group-isolation')).toHaveCount(0);
  await page.getByRole('button',{name:'Save Symbol Studio'}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export Symbol Studio JSON'}).click();
  const handle=await download;
  const stream=await handle.createReadStream();let body='';
  for await(const chunk of stream)body+=chunk.toString();
  const doc=JSON.parse(body);
  expect(doc.nodes).toHaveLength(1);
  expect(doc.nodes[0].kind).toBe('group');
  expect(doc.nodes[0].children).toHaveLength(2);
  expect(doc.states.find((s:{id:string})=>s.id==='OPEN').overrides['starter-line'].style.stroke)
    .toBe('#ff8833');
});
test('group right-click menu, deep duplicate, Undo and lossless ungroup',async({page})=>{
  await newGroupedSymbol(page);
  const group=page.getByRole('button',{name:'Select Group'});
  await group.click({button:'right'});
  await expect(page.getByRole('menuitem',{name:'Edit group contents'})).toBeVisible();
  await page.getByRole('menuitem',{name:'Duplicate element'}).click();
  await expect(page.locator('button.layer').filter({hasText:'Group copy'})).toBeVisible();
  await page.getByRole('button',{name:'Undo Symbol Studio'}).click();
  await expect(page.locator('button.layer').filter({hasText:'Group copy'})).toHaveCount(0);
  await page.getByRole('button',{name:'Select Group'}).click();
  await page.keyboard.press('Control+Shift+g');
  await expect(page.getByRole('button',{name:'Select Group'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Select Starter line'})).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button',{name:'Select Group'})).toBeVisible();
  await page.getByRole('button',{name:'Select Group'}).dblclick();
  await expect(page.getByTestId('group-isolation')).toBeVisible();
});
test('group geometry moves together and child stays editable only in isolation',async({page})=>{
  await newGroupedSymbol(page);
  const group=page.getByRole('button',{name:'Select Group'});
  await group.click();
  await page.getByRole('spinbutton',{name:'Studio rotation'}).fill('30');
  await page.getByRole('spinbutton',{name:'Studio rotation'}).press('Tab');
  const exportJson=async()=>{
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export Symbol Studio JSON'}).click();
    const file=await download;const stream=await file.createReadStream();let s='';
    for await(const chunk of stream)s+=chunk.toString();
    return JSON.parse(s);
  };
  const before=await exportJson();
  expect(before.nodes[0].transform.rotation).toBe(30);
  await group.dblclick();
  await page.getByRole('button',{name:'Select Starter line'}).click();
  const color=page.locator('input[aria-label="Studio stroke color"]');
  await color.fill('#33d5eb');await color.dispatchEvent('change');
  await page.keyboard.press('Escape');
  const after=await exportJson();
  expect(after.nodes[0].transform.rotation).toBe(30);
  expect(after.nodes[0].children.find((n:{id:string})=>n.id==='starter-line').style.stroke)
    .toBe('#33d5eb');
});
