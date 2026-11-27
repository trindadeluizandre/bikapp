const fs = require('fs');
const { defineConfig } = require('@playwright/test');

const braveCandidates = [
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
];
const braveExecutable = braveCandidates.find((p) => fs.existsSync(p));

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
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
      ...(braveExecutable ? { executablePath: braveExecutable } : {}),
      slowMo: 60,
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});