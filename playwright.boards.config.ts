import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const id = randomUUID();
export default defineConfig({
  testDir: './tests/boards',
  outputDir: 'test-results/boards',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  use: {
    actionTimeout: 10000,
    baseURL: 'http://127.0.0.1:5192',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3112/health/ready',
      reuseExistingServer: false,
      env: {
        DATABASE_PATH: `./data/e2e/boards-${id}.sqlite`,
        MEDIA_ROOT: `./data/e2e/boards-${id}-media`,
        SETUP_TOKEN: 'playwright-formal-boards-setup-2026',
        PORT: '3112',
        APP_ORIGINS: 'http://127.0.0.1:5192',
        COOKIE_SECURE: 'false',
        NODE_ENV: 'test',
        PROVIDER_MASTER_KEY: 'c'.repeat(64),
      },
    },
    {
      command: 'node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5192 --strictPort',
      url: 'http://127.0.0.1:5192',
      reuseExistingServer: false,
      env: { STUDIO_API_TARGET: 'http://127.0.0.1:3112' },
    },
  ],
});
