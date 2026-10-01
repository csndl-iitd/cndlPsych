import { expect, test } from '@playwright/test';
import { atStage, eventsOf, openApp, pointerDriver, stageRect, tap } from '../../tools/e2e/helpers.js';
import { computeLayout } from './geometry.js';

test.afterEach(({ page }) => {
  expect(page.appErrors ?? []).toEqual([]);
});

const scope = (extra = {}) => ({ intents: {}, rules: [], gestures: ['tap'], ...extra });

async function viewport(page) {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

test('letterboxes a 4:3 stage and reports it in stage.resize', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openApp(page, { stageSpec: { aspect: '4:3' }, scope: scope() });
  const expected = computeLayout({ ...(await viewport(page)), aspect: '4:3' });
  const rect = await stageRect(page);
  for (const key of ['x', 'y', 'w', 'h']) expect(rect[key]).toBeCloseTo(expected[key], 0);
  expect(rect.w / rect.h).toBeCloseTo(4 / 3, 2);

  const [resize] = await eventsOf(page, 'stage.resize');
  expect(resize.data.rect).toEqual(rect);
  expect(resize.data.viewport).toEqual({ w: 1000, h: 800 });
});

test('stage coordinates stay correct under letterboxing and after a resize', async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openApp(page, { stageSpec: { aspect: '4:3' }, scope: scope() });
  const driver = await pointerDriver(page, isMobile);

  const [cx, cy] = await atStage(page, 0.25, 0.75);
  await tap(driver, page, cx, cy);
  let [first] = await eventsOf(page, 'input.tap');
  expect(first.data.up.x).toBeCloseTo(0.25, 2);
  expect(first.data.up.y).toBeCloseTo(0.75, 2);

  await page.setViewportSize({ width: 800, height: 1000 });
  await expect.poll(async () => (await eventsOf(page, 'stage.resize')).length).toBe(2);
  const rect = await stageRect(page);
  expect(rect.w / rect.h).toBeCloseTo(4 / 3, 2);
  expect(rect.w).toBeCloseTo(800, 0);

  const [rx, ry] = await atStage(page, 0.25, 0.75);
  await tap(driver, page, rx, ry);
  [, first] = await eventsOf(page, 'input.tap');
  expect(first.data.up.x).toBeCloseTo(0.25, 2);
  expect(first.data.up.y).toBeCloseTo(0.75, 2);
  expect((await eventsOf(page, 'stage.resize')).at(-1).data.orientation).toBe('portrait');
});

test('a tap in the letterbox lands outside 0-1 and is flagged inside_stage: false', async ({ page, isMobile }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openApp(page, { stageSpec: { aspect: '4:3' }, scope: scope() });
  const driver = await pointerDriver(page, isMobile);
  await tap(driver, page, 500, 5);
  const [down] = await eventsOf(page, 'input.pointer.down');
  expect(down.data.inside_stage).toBe(false);
  expect(down.data.y).toBeLessThan(0);
  const [tapEvent] = await eventsOf(page, 'input.tap');
  expect(tapEvent.data.up.y).toBeLessThan(0);
});

test('fill uses the whole viewport and a margin shrinks the stage', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await openApp(page, { stageSpec: { aspect: 'fill', margin: '20px' }, scope: scope() });
  const rect = await stageRect(page);
  expect(rect).toMatchObject({ x: 20, y: 20, w: 860, h: 560 });
});

test('bare lengths are fractions of the shorter side; mm without calibration is an estimate, logged once', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await openApp(page, { stageSpec: { aspect: '4:3' }, scope: scope() });
  const rect = await stageRect(page);
  expect(await page.evaluate(() => window.app.stage.lengthToPx(0.1))).toBeCloseTo(rect.h * 0.1, 5);
  expect(await page.evaluate(() => window.app.stage.lengthToPx('25%'))).toBeCloseTo(rect.w * 0.25, 5);
  expect(await page.evaluate(() => window.app.stage.lengthToPx('5mm'))).toBeCloseTo((5 * 96) / 25.4, 5);
  await page.evaluate(() => window.app.stage.lengthToPx('8mm'));
  const warnings = await eventsOf(page, 'system.warning');
  expect(warnings).toHaveLength(1);
  expect(warnings[0].data.code).toBe('uncalibrated_units');
  expect(await page.evaluate(() => { try { window.app.stage.lengthToPx('1deg'); return 'no error'; } catch (e) { return e.message; } })).toContain('calibration');
});

test('hit testing finds registered targets by data-role / data-id, with hit_padding for fingers', async ({ page, isMobile }) => {
  await openApp(page, { stageSpec: { aspect: 'fill' }, scope: scope({ hit_padding: '20px' }) });
  await page.evaluate(() => {
    window.app.addTarget({ id: 7, role: 'target', left: 100, top: 100 });
    window.app.addTarget({ id: 'x', role: 'distractor', left: 300, top: 100 });
  });
  const driver = await pointerDriver(page, isMobile);
  const rect = await stageRect(page);
  await tap(driver, page, rect.x + 140, rect.y + 140);
  await tap(driver, page, rect.x + 85, rect.y + 140);
  await tap(driver, page, rect.x + 60, rect.y + 140);
  await tap(driver, page, rect.x + 340, rect.y + 140);
  const targets = (await eventsOf(page, 'input.tap')).map((e) => e.data.target);
  expect(targets).toEqual([{ id: 7, role: 'target' }, { id: 7, role: 'target' }, null, { id: 'x', role: 'distractor' }]);
});

test('every event the stage and input emit validates against the event schema', async ({ page, isMobile }) => {
  await openApp(page, { stageSpec: { aspect: '16:9' }, scope: scope({ gestures: ['tap', 'longpress', 'swipe'] }) });
  const driver = await pointerDriver(page, isMobile);
  await tap(driver, page, 300, 300);
  // The app validates on emit and throws on a bad event, so reaching here with events logged is the check.
  expect((await eventsOf(page)).length).toBeGreaterThan(2);
});
