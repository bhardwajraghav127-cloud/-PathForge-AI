import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  timeout: 90000,
  expect: { timeout: 30000 },
  use: {
    baseURL: 'http://localhost:8471',
    channel: 'chrome',
    headless: true,
  },
  webServer: {
    command: 'npm run preview -- --port 8471 --strictPort',
    url: 'http://localhost:8471',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
