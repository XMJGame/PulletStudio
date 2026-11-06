import { defineConfig } from '@playwright/test';
import boards from './playwright.boards.config';
// Reuse isolated API/Vite bootstrap, not any board fixture or production database.
export default defineConfig({
  ...boards,
  testDir: './tests/workflows',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/workflows',
  webServer: [
    ...boards.webServer,
    {
      command: 'node apps/api/dist/generation-worker.js',
      wait: { stdout: /Media generation worker ready/ },
      reuseExistingServer: false,
      env: boards.webServer[0].env,
    },
  ],
});
