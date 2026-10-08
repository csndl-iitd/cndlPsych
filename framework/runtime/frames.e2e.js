// Frame-locked phases in a real browser: durations are whole numbers of frames, and a phase that
// ends on its last frame hands over to the next one in that same frame.
import { expect, test } from '@playwright/test';
import { captureLog, installAutopilot, passEntryScreens, startSession } from '../../tools/e2e/session-helpers.js';

test.setTimeout(120_000);
test.skip(({ isMobile }) => isMobile, 'the device kind does not matter here');

const ofType = (events, type) => events.filter((e) => e.type === type);

test('the flash block runs on frame boundaries: durations are the planned frames, and each phase starts in the frame the last one ended', async ({ page }) => {
  await startSession(page, { merge: { triggers: { sinks: [] }, overlay: { apriltags: { enabled: false }, photodiode: { enabled: false } } } }); // real speed
  await captureLog(page);
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page);
  await expect.poll(() => page.evaluate(() => window.__log.some((e) => e.type === 'block.end' && e.block === 'flash_task')), { timeout: 60_000 }).toBe(true);
  const events = await page.evaluate(() => window.__log);
  const frameMs = await page.evaluate(() => window.sessionServices.frames?.frameMs ?? null);
  expect(frameMs).toBeGreaterThan(5);

  const flashes = events.filter((e) => e.block === 'flash_task' && (e.type === 'phase.onset' || e.type === 'phase.offset') && e.data.stimulus?.startsWith('flash_'));
  const onsets = flashes.filter((e) => e.type === 'phase.onset');
  const offsets = flashes.filter((e) => e.type === 'phase.offset');
  expect(onsets).toHaveLength(20);
  expect(onsets.every((e) => e.data.planned_frames === Math.round(250 / frameMs))).toBe(true);

  // every flash lasts exactly its frames, to the precision of the timestamps
  const lengths = offsets.map((e) => e.data.actual_ms);
  const exact = lengths.filter((ms) => Math.abs(ms - Math.round(ms / frameMs) * frameMs) < 1);
  expect(exact.length).toBeGreaterThanOrEqual(19);
  expect(offsets.filter((e) => e.data.frames === Math.round(250 / frameMs)).length).toBeGreaterThanOrEqual(19);

  // a flash ends and the next begins in the same frame: the same timestamp
  const handedOver = onsets.slice(1).filter((onset, i) => onset.t === offsets[i].t);
  expect(handedOver.length).toBeGreaterThanOrEqual(17);

  // so the rhythm is a whole number of frames throughout
  const intervals = onsets.slice(1).map((e, i) => e.t - onsets[i].t);
  expect(intervals.filter((ms) => Math.abs(ms - Math.round(ms / frameMs) * frameMs) < 1).length).toBeGreaterThanOrEqual(18);
  expect(ofType(events, 'system.error')).toEqual([]);
});

test('a blocked main thread makes a late frame that is counted, and later flashes are on time again', async ({ page }) => {
  await startSession(page, { merge: { triggers: { sinks: [] }, overlay: { apriltags: { enabled: false }, photodiode: { enabled: false } } } });
  await captureLog(page);
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page);
  await page.waitForFunction(() => window.__log.some((e) => e.type === 'phase.onset' && e.data.stimulus === 'flash_black'), null, { timeout: 60_000 });
  // Block the page for ~120 ms (about 7 frames) across the end of one flash: from 200 ms into the fifth one, which ends at 250 ms.
  await page.evaluate(() => {
    let onsets = 0;
    const off = window.sessionServices.bus.on('phase.onset', (event) => {
      if (!event.data.stimulus?.startsWith('flash_')) return;
      onsets += 1;
      if (onsets !== 5) return;
      off();
      setTimeout(() => { const end = performance.now() + 120; while (performance.now() < end); }, 200);
    });
  });
  await expect.poll(() => page.evaluate(() => window.__log.some((e) => e.type === 'block.end' && e.block === 'flash_task')), { timeout: 60_000 }).toBe(true);
  const events = await page.evaluate(() => window.__log);
  const planned = new Map(ofType(events, 'phase.onset').map((e) => [`${e.trial}|${e.data.phase}`, e.data.planned_frames]));
  const flashes = ofType(events, 'phase.offset').filter((e) => e.block === 'flash_task' && e.data.stimulus?.startsWith('flash_'));
  const late = flashes.filter((e) => e.data.frames > planned.get(`${e.trial}|${e.data.phase}`));
  expect(late.length).toBeGreaterThanOrEqual(1);
  expect(late.length).toBeLessThanOrEqual(2); // the blocked stretch, not the rest of the block
  const lastLate = flashes.indexOf(late.at(-1));
  expect(flashes.slice(lastLate + 1).every((e) => e.data.frames === planned.get(`${e.trial}|${e.data.phase}`))).toBe(true);
  expect(flashes.slice(lastLate + 1).length).toBeGreaterThan(3);
});
