const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'node apps/backend/src/server.js',
    url: 'http://localhost:3333/health',
    reuseExistingServer: true,
    timeout: 30000,
  },
  use: {
    baseURL: process.env.BIKAPP_URL || 'http://localhost:3333',
    headless: false,
    viewport: { width: 460, height: 780 },
    launchOptions: {
      slowMo: 250,
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});