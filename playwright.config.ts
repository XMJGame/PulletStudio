import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const isolatedId = randomUUID();
const databasePath = `./data/e2e/${isolatedId}.sqlite`;
const testEnvironment = {
  DATABASE_PATH: databasePath,
  MEDIA_ROOT: `./data/e2e/${isolatedId}-media`,
  SETUP_TOKEN: 'playwright-local-test-setup-token-2026',
  PORT: '3109',
  APP_ORIGINS: 'http://127.0.0.1:5189',
  COOKIE_SECURE: 'false',
  NODE_ENV: 'test',
  PROVIDER_MASTER_KEY: 'c'.repeat(64),
};
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/production',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5189',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      url: 'http://127.0.0.1:3109/health/ready',
      reuseExistingServer: false,
      env: testEnvironment,
    },
    {
      command: 'node apps/api/dist/generation-worker.js',
      wait: { stdout: /Media generation worker ready/ },
      reuseExistingServer: false,
      env: testEnvironment,
    },
    {
      command: 'node apps/api/dist/animatic-worker.js',
      wait: { stdout: /Animatic worker ready/ },
      reuseExistingServer: false,
      env: testEnvironment,
    },
    {
      command: 'node tests/fixtures/text-mock.mjs',
      url: 'http://127.0.0.1:3118/health',
      reuseExistingServer: false,
      env: { TEXT_MOCK_PORT: '3118' },
    },
    {
      command: 'node apps/api/dist/text-worker.js',
      wait: { stdout: /Text analysis worker ready/ },
      reuseExistingServer: false,
      env: testEnvironment,
    },
    {
      command: 'node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5189 --strictPort',
      url: 'http://127.0.0.1:5189',
      reuseExistingServer: false,
      env: { STUDIO_API_TARGET: 'http://127.0.0.1:3109' },
    },
  ],
});
