import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const root = resolve(process.env.PULLET_PREVIEW_TEST_ROOT || '.');
if (!/[\\/]data[\\/]e2e[\\/]/.test(root))
  throw new Error('Set PULLET_PREVIEW_TEST_ROOT to an unpacked QA copy under data/e2e.');
const config = JSON.parse(readFileSync(resolve(root, 'data/preview-config.json'), 'utf8'));
if (config.webPort !== 5192 || config.apiPort !== 3112 || config.setupToken !== 'c'.repeat(64))
  throw new Error('Preview browser tests require the isolated runtime-test configuration.');

// The separately unpacked preview is started explicitly with its own empty QA DB.
// No dev Vite/API/Worker process is launched by this configuration.
export default defineConfig({
  testDir: './tests/boards',
  outputDir: 'test-results/preview',
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
});
