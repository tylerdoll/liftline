import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',use:{baseURL:'http://127.0.0.1:4173',headless:true},webServer:{command:'node --import tsx scripts/baseline-server.ts',url:'http://127.0.0.1:4173',reuseExistingServer:false},workers:1});
