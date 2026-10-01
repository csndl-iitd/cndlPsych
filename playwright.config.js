import { defineConfig, devices } from '@playwright/test';

// Browser tests sit beside the code as *.e2e.js. Desktop and phone (touch) emulation
// both run on Chromium; real phones and WebKit/Firefox are not covered.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.e2e.js',
  testIgnore: 'node_modules/**',
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
});
