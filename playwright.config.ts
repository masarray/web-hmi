import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',timeout:45_000,fullyParallel:false,
  forbidOnly:!!process.env['CI'],retries:process.env['CI']?1:0,
  workers:1,reporter:'list',
  use:{baseURL:'http://127.0.0.1:4200',trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:900}}}],
  webServer:[
    {command:'npm start',url:'http://127.0.0.1:4200',
      reuseExistingServer:!process.env['CI'],timeout:120_000},
    {command:'npm run start:server',url:'http://127.0.0.1:8787/health',
      reuseExistingServer:!process.env['CI'],timeout:120_000}
  ]
});
