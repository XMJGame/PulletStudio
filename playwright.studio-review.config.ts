import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/design-review',
  outputDir: 'test-results/studio-review-runs',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5196',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5196 --strictPort',
    url: 'http://127.0.0.1:5196/studio-review.html',
    reuseExistingServer: false,
  },
});
