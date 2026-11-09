import { defineConfig } from '@playwright/test';
import boards from './playwright.boards.config';
export default defineConfig({
  ...boards,
  testDir: './tests/settings',
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results/settings',
});
