import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/canvas',
  outputDir: 'test-results/canvas',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  use: {
    actionTimeout: 8000,
    baseURL: 'http://127.0.0.1:5191',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5191 --strictPort',
    url: 'http://127.0.0.1:5191/canvas-lab.html',
    reuseExistingServer: false,
  },
});
