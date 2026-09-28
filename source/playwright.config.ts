import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env', quiet: true });

export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 60_000,
  outputDir: '.runtime/browser-tests', reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173', browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
    headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'node --env-file=../../.env dist/main.js', cwd: './apps/api',
      url: 'http://127.0.0.1:3001/api/v1/health', reuseExistingServer: !process.env.CI,
      env: { PORT: '3001', WEB_ORIGIN: 'http://localhost:5173' } },
    { command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 5173 --configLoader runner', cwd: './apps/web',
      url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  ],
});
