import { expect, test } from '@playwright/test';

// The project name is the profile Chromium's emulation should be detected as.
async function runInBrowser(page, allowed) {
  await page.goto('/tools/blank.html');
  return page.evaluate(async (allowedProfiles) => {
    const device = await import('/framework/foundation/device.js');
    const { createBus } = await import('/framework/foundation/events.js');
    const { createClock } = await import('/framework/foundation/clock.js');
    const env = device.readEnvironment();
    const bus = createBus({ clock: createClock() });
    const log = [];
    bus.on('*', (event) => log.push({ seq: event.seq, type: event.type, data: event.data }));
    const result = device.admitDevice(bus, { allowed: allowedProfiles }, { env });
    return { env, result, log };
  }, allowed);
}

test('detects the emulated device from real browser capabilities', async ({ page }, testInfo) => {
  const { env, result } = await runInBrowser(page, ['desktop', 'phone', 'tablet']);
  expect(result.profile, JSON.stringify(env)).toBe(testInfo.project.name);
  expect(result.candidates).toEqual([testInfo.project.name]);
  expect(result.admitted).toBe(true);
  expect(env.pointer).toBe(testInfo.project.name === 'desktop' ? 'fine' : 'coarse');
  // A desktop may report touch points too (touch-screen hosts); only phones and tablets must.
  if (testInfo.project.name !== 'desktop') expect(env.touch).toBe(true);
});

test('writes device_rejected when the detected profile is not allowed', async ({ page }, testInfo) => {
  const other = testInfo.project.name === 'desktop' ? ['phone'] : ['desktop'];
  const { result, log } = await runInBrowser(page, other);
  expect(result.admitted).toBe(false);
  expect(log.map((e) => [e.seq, e.type])).toEqual([[0, 'device.profile'], [1, 'session.end']]);
  expect(log[0].data.profile).toBe(testInfo.project.name);
  expect(log[1].data).toEqual({ reason: 'device_rejected' });
});

test('admits the allowed device with only device.profile in the log', async ({ page }, testInfo) => {
  const { log } = await runInBrowser(page, [testInfo.project.name]);
  expect(log.map((e) => e.type)).toEqual(['device.profile']);
});
