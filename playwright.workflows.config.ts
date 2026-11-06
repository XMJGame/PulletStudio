import { defineConfig } from '@playwright/test';
import boards from './playwright.boards.config';
// Share the isolated API, worker and Vite bootstrap.
export default defineConfig({
  ...boards,
  testDir: './tests/workflows',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/workflows',
});
