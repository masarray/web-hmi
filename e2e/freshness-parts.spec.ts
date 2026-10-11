import {test,expect} from '@playwright/test';

test('fresh telemetry automatically becomes STALE without another browser action',async({page})=>{
  await page.goto('/');
  await page.getByRole('searchbox',{name:'Search symbols'}).fill('motor');
  await page.getByRole('button',{name:'Add Motor Simb SVG symbol'}).click();
  await page.getByRole('combobox',{name:'Symbol animation'}).selectOption('spin');
  await page.getByLabel('Tag identifier').fill('Plant/Motor');
  await page.getByLabel('Tag identifier').press('Tab');
  const motor=page.locator('g.canvas-node').last();
  await page.getByRole('button',{name:/Preview/}).click();
  await page.getByRole('button',{name:'Set ON'}).click();
  await expect(motor).toHaveAttribute('data-visual-status','ACTIVE');
  await expect(motor.locator('g.process-rotor')).toHaveCount(1);
  // Event-driven timer expires this sample even with no user interaction.
  await expect(motor).toHaveAttribute('data-visual-quality','STALE',{timeout:7500});
  await expect(motor.locator('g.process-rotor')).toHaveCount(0);
  await expect(motor.locator('.visual-quality-indicator text')).toHaveText('STALE');
  await page.getByRole('button',{name:'Set ON'}).click();
  await expect(motor).toHaveAttribute('data-visual-status','ACTIVE');
});

test('component behavior is per-part, persisted and fail-closed',async({page})=>{
  await page.goto('/');
  await page.getByRole('searchbox',{name:'Search symbols'}).fill('pumpgear');
  await page.getByRole('button',{name:'Add Pumpgear SVG symbol'}).click();
  await page.getByRole('combobox',{name:'Symbol animation'}).selectOption('spin');
  await page.getByLabel('Tag identifier').fill('Plant/Gear');
  await page.getByLabel('Tag identifier').press('Tab');
  await page.getByRole('combobox',{name:'Part 1 behavior'}).selectOption('fixed');
  await page.getByRole('combobox',{name:'Part 2 behavior'}).selectOption('state-color');
  await page.getByRole('combobox',{name:'Part 3 behavior'}).selectOption('hide-idle');
  await page.getByRole('combobox',{name:'Part 4 behavior'}).selectOption('spin-active');
  const graphic=page.locator('g.canvas-node').last().locator('svg.process-graphic');
  await page.getByRole('button',{name:/Preview/}).click();
  await page.getByRole('button',{name:'Set ON'}).click();
  await expect(graphic.locator('g[data-part-index="3"]')).toHaveClass(/process-rotor/);
  await expect(graphic.locator('g[data-part-index="1"] path')).toHaveAttribute('stroke','#67d9a8');
  await page.getByRole('button',{name:'Set OFF'}).click();
  await expect(graphic.locator('g[data-part-index="2"]')).toHaveAttribute('display','none');
  await expect(graphic.locator('g[data-part-index="3"]')).not.toHaveClass(/process-rotor/);
  await page.getByRole('combobox',{name:'Simulation quality'}).selectOption('BAD');
  await expect(graphic.locator('g[data-part-index="3"]')).not.toHaveClass(/process-rotor/);
  await expect(graphic.locator('g[data-part-index="1"] path')).toHaveAttribute('stroke','#fc7187');
  await page.getByRole('button',{name:/Exit Preview/}).click();
  await page.reload();
  await page.locator('g.canvas-node').last().click();
  await expect(page.getByRole('combobox',{name:'Part 1 behavior'})).toHaveValue('fixed');
  await expect(page.getByRole('combobox',{name:'Part 3 behavior'})).toHaveValue('hide-idle');
  await expect(page.getByRole('combobox',{name:'Part 4 behavior'})).toHaveValue('spin-active');
});

test('browser DOM initialization baseline at 100, 500 and 1000 graphical symbols',async({page})=>{
  test.setTimeout(120_000);
  await page.goto('/');
  for(const count of [100,500,1000]){
    await page.evaluate((n)=>{
      const key='web-hmi.project.v1';
      const base=JSON.parse(localStorage.getItem(key)??'null') ??
        {schemaVersion:1,id:'scale-demo',name:'Scale',activePageId:'scale',pages:[{id:'scale',name:'Scale',shapes:[]}]};
      const id=base.activePageId;
      base.pages=base.pages.map((p:any)=>p.id!==id?p:{
        ...p,shapes:Array.from({length:n},(_,i)=>({
          id:'perf-'+i,kind:'symbol',name:'Motor '+i,
          x:(i%40)*26,y:Math.floor(i/40)*26,width:20,height:20,
          fill:'#29465c',stroke:'#80bcd6',text:'',tagId:'',animation:'none',
          symbolId:'motor-simb'
        }))
      });
      localStorage.setItem(key,JSON.stringify(base));
    },count);
    const started=Date.now();
    await page.reload({waitUntil:'domcontentloaded'});
    await expect(page.locator('g.canvas-node')).toHaveCount(count,{timeout:40000});
    const elapsed=Date.now()-started;
    const metrics=await page.evaluate(()=>({
      svgNodes:document.querySelectorAll('svg.process-graphic').length,
      domNodes:document.querySelectorAll('body *').length
    }));
    expect(metrics.svgNodes).toBe(count);
    console.log(JSON.stringify({benchmark:'CP06B-browser-init',symbols:count,loadMs:elapsed,...metrics}));
  }
});
