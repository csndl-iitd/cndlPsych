import { defineConfig, devices } from '@playwright/test';

// Browser tests sit beside the code as *.e2e.js. Desktop, phone and tablet (touch)
// emulation all run on Chromium; real devices and WebKit/Firefox are not covered.
const PORT = 4173;

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.js',
  testIgnore: 'node_modules/**',
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: 'node tools/build-e2e.js && node tools/static-server.js',
    url: `http://localhost:${PORT}/tools/blank.html`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { ...devices['Galaxy Tab S4'] } },
  ],
});
