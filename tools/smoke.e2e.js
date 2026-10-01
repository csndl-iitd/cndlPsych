import { test, expect } from '@playwright/test';

// Proves the browser harness works in both emulation modes; real browser tests start in M2/M3.
test('harness reports the emulated input mode', async ({ page, isMobile }) => {
  await page.setContent('<button id="b">go</button>');
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  expect(coarse).toBe(isMobile);
});
