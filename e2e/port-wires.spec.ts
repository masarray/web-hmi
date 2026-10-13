import {test,expect} from '@playwright/test';

test('HMI V2 attaches wire to two symbol ports, updates on resize and retains portable topology',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  await page.getByRole('textbox',{name:'Symbol name'}).fill('Wired Test Switch');
  await page.getByRole('textbox',{name:'Symbol name'}).press('Tab');
  await page.getByRole('button',{name:'Save Symbol Studio'}).click();
  await page.getByRole('button',{name:'Back to HMI Editor'}).click();

  const palette=page.getByRole('button',{name:'Add V2 Wired Test Switch'});
  await expect(palette).toBeVisible();
  await palette.click();await palette.click();
  const nodes=page.locator('g.canvas-node:has(svg[data-vector-symbol-id="user-cb-starter"])');
  await expect(nodes).toHaveCount(2);

  const connect=page.getByRole('button',{name:'Draw electrical wires'});
  await connect.click();
  await expect(connect).toHaveAttribute('aria-pressed','true');
  await nodes.nth(0).locator('[data-vector-port=bottom] circle').first().click();
  await expect(page.getByTestId('wire-source')).toContainText('bottom');
  await nodes.nth(1).locator('[data-vector-port=top] circle').first().click();
  await expect(page.getByTestId('wire-source')).toHaveCount(0);
  const wire=page.locator('.port-wire-line');
  await expect(wire).toHaveCount(1);
  const before=await wire.getAttribute('d');
  await connect.click();

  // Select first instance and edit geometry through the standard Inspector:
  // no manual wire coordinate updates are allowed/needed.
  await nodes.nth(0).locator('svg.vector-symbol').click({position:{x:30,y:30}});
  const geometry=page.locator('.inspector .field-grid').first().locator('input');
  await expect(geometry).toHaveCount(4);
  const x=Number(await geometry.nth(0).inputValue());
  await geometry.nth(0).fill(String(x+100));await geometry.nth(0).press('Tab');
  await expect(wire).not.toHaveAttribute('d',before!);
  const afterMove=await wire.getAttribute('d');

  const width=Number(await geometry.nth(2).inputValue());
  await geometry.nth(2).fill(String(width+80));await geometry.nth(2).press('Tab');
  await expect(wire).not.toHaveAttribute('d',afterMove!);

  // Wires are independent of state/quality animation.
  await page.getByRole('button',{name:/Preview/}).click();
  await expect(wire).toHaveCount(1);
  await page.getByRole('button',{name:'Exit Preview'}).click();

  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'⇩ Export',exact:true}).click();
  const file=await download,stream=await file.createReadStream();let text='';
  for await(const chunk of stream)text+=chunk.toString();
  const project=JSON.parse(text);
  expect(project.pages[0].wires).toHaveLength(1);
  const endpoints=project.pages[0].wires[0];
  expect(endpoints.from.portId).toBe('bottom');
  expect(endpoints.to.portId).toBe('top');
  expect(endpoints.from.shapeId).not.toBe(endpoints.to.shapeId);
});

test('wire can be selected and deleted with Undo restoring topology',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Open Symbol Studio'}).click();
  await page.getByRole('textbox',{name:'Symbol name'}).fill('Connected Switch');
  await page.getByRole('textbox',{name:'Symbol name'}).press('Tab');
  await page.getByRole('button',{name:'Save Symbol Studio'}).click();
  await page.getByRole('button',{name:'Back to HMI Editor'}).click();
  const palette=page.getByRole('button',{name:'Add V2 Connected Switch'});
  await palette.click();await palette.click();
  const nodes=page.locator('g.canvas-node:has(svg[data-vector-symbol-id="user-cb-starter"])');
  await page.getByRole('button',{name:'Draw electrical wires'}).click();
  await nodes.nth(0).locator('[data-vector-port=bottom] circle').first().click();
  await nodes.nth(1).locator('[data-vector-port=top] circle').first().click();
  await page.getByRole('button',{name:'Draw electrical wires'}).click();
  const path=page.locator('path.port-wire-hit');
  await expect(path).toHaveCount(1);
  // SVG DOM pointerdown at an in-path location (middle of its orthogonal elbow).
  const d=await path.getAttribute('d');expect(d).toBeTruthy();
  const coords=d!.match(/[-+]?\d*\.?\d+/g)!.map(Number);
  const y=coords[3]!,x=coords[2]!;
  const viewport=page.locator('svg.viewport');
  const pt=await viewport.evaluate((node,{x,y})=>{
    const svg=node as SVGSVGElement,m=svg.getScreenCTM()!;
    const p=svg.createSVGPoint();p.x=x;p.y=y;
    const s=p.matrixTransform(m);return {x:s.x,y:s.y};
  },{x,y});
  await page.mouse.click(pt.x,pt.y);
  await expect(page.getByTestId('wire-inspector')).toBeVisible();
  await page.getByRole('button',{name:'Delete connected wire'}).click();
  await expect(page.locator('.port-wire-line')).toHaveCount(0);
  await page.getByRole('button',{name:'Undo (Ctrl+Z)'}).click();
  await expect(page.locator('.port-wire-line')).toHaveCount(1);
});
