import { defineConfig } from 'vitest/config';

// Tests that need the Firestore emulator (Java; downloaded into .tools/ on first run).
// Run with: npm run test:emulator
export default defineConfig({
  test: {
    include: ['**/*.emulator.test.js'],
    exclude: ['node_modules/**'],
    globalSetup: ['./tools/emulator-global-setup.js'],
    testTimeout: 90_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
