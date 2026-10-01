import { expect, test } from '@playwright/test';
import { atStage, eventsOf, gesture, openApp, pointerDriver, stageRect, tap, typesOf } from '../../tools/e2e/helpers.js';

test.afterEach(({ page }) => {
  expect(page.appErrors ?? []).toEqual([]);
});

const scope = (gestures, extra = {}) => ({ intents: {}, rules: [], gestures, ...extra });
const pointerType = (isMobile) => (isMobile ? 'touch' : 'mouse');

test('a real tap produces the documented fields and is all_trusted, with raw trusted pointer events', async ({ page, isMobile }) => {
  await openApp(page, { scope: scope(['tap']) });
  const driver = await pointerDriver(page, isMobile);
  const [cx, cy] = await atStage(page, 0.4, 0.6);
  await tap(driver, page, cx, cy, 60);

  const [tapEvent] = await eventsOf(page, 'input.tap');
  expect(tapEvent.source).toBe('input');
  expect(tapEvent.data).toMatchObject({ pointer_type: pointerType(isMobile), all_trusted: true, tap_index: 1, target: null, gesture_id: 1 });
  expect(tapEvent.data.up.x).toBeCloseTo(0.4, 2);
  expect(tapEvent.data.up.y).toBeCloseTo(0.6, 2);
  expect(tapEvent.data.duration_ms).toBeGreaterThan(30);
  expect(tapEvent.data.t_up).toBe(tapEvent.t);

  const raw = await eventsOf(page, 'input.pointer');
  expect(raw.map((e) => e.type)).toEqual(['input.pointer.down', 'input.pointer.up']);
  expect(raw.every((e) => e.data.trusted === true && e.data.pointer_type === pointerType(isMobile))).toBe(true);
  expect(raw[0].t).toBeLessThan(raw[1].t);
});

test('script-generated pointer events are marked untrusted, on the raw events and the gesture', async ({ page }) => {
  await openApp(page, { scope: scope(['tap']) });
  await page.evaluate(() => {
    const fire = (type, t) => window.app.root.dispatchEvent(new PointerEvent(type, {
      clientX: 200, clientY: 200, pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true, bubbles: true, pressure: t === 'down' ? 0.5 : 0,
    }));
    fire('pointerdown', 'down');
    fire('pointerup', 'up');
  });
  const raw = await eventsOf(page, 'input.pointer');
  expect(raw.map((e) => e.data.trusted)).toEqual([false, false]);
  const [tapEvent] = await eventsOf(page, 'input.tap');
  expect(tapEvent.data.all_trusted).toBe(false);
});

test('a swipe reports direction, distance and velocities', async ({ page, isMobile }) => {
  await openApp(page, { scope: scope(['swipe']) });
  const driver = await pointerDriver(page, isMobile);
  const from = await atStage(page, 0.7, 0.5);
  await gesture(driver, page, from, [from[0] - 220, from[1]], { ms: 180 });

  const [swipe] = await eventsOf(page, 'input.swipe');
  expect(swipe.data).toMatchObject({ direction: 'left', all_trusted: true });
  expect(swipe.data.distance).toBeGreaterThan(200);
  expect(swipe.data.dx).toBeLessThan(-200);
  expect(Math.abs(swipe.data.dy)).toBeLessThan(5);
  expect(swipe.data.mean_velocity).toBeGreaterThan(0.2);
  expect(swipe.data.straightness).toBeGreaterThan(0.95);
  expect(await typesOf(page, 'input.tap')).toEqual([]);
});

test('a long press fires start at the threshold and end on release, with no tap', async ({ page, isMobile }) => {
  await openApp(page, { scope: scope(['tap', 'longpress']) });
  const driver = await pointerDriver(page, isMobile);
  const [cx, cy] = await atStage(page, 0.5, 0.5);
  await driver.down(cx, cy);
  await page.waitForTimeout(700);
  await driver.up();

  expect(await typesOf(page, 'input.')).toEqual(['input.pointer.down', 'input.longpress.start', 'input.pointer.up', 'input.longpress.end']);
  const [start] = await eventsOf(page, 'input.longpress.start');
  expect(start.data.threshold_ms).toBe(500);
  expect(start.data.t_fire - start.data.t_down).toBeGreaterThanOrEqual(480);
  const [end] = await eventsOf(page, 'input.longpress.end');
  expect(end.data).toMatchObject({ tap_suppressed: true, all_trusted: true });
  expect(end.data.duration_ms).toBeGreaterThan(600);
});

test('a drag starts after the slop and ends with displacement; the dragged element is the target', async ({ page, isMobile }) => {
  await openApp(page, { scope: scope(['drag']) });
  await page.evaluate(() => window.app.addTarget({ id: 3, role: 'item', left: 100, top: 100 }));
  const driver = await pointerDriver(page, isMobile);
  const rect = await stageRect(page);
  await gesture(driver, page, [rect.x + 140, rect.y + 140], [rect.x + 400, rect.y + 300], { ms: 300, steps: 10 });

  expect(await typesOf(page, 'input.drag')).toEqual(['input.drag.start', 'input.drag.end']);
  const [start] = await eventsOf(page, 'input.drag.start');
  expect(start.data.target).toEqual({ id: 3, role: 'item' });
  expect(start.data.grab_offset).toEqual({ x: 0, y: 0 });
  const [end] = await eventsOf(page, 'input.drag.end');
  expect(end.data.displacement).toBeCloseTo(Math.hypot(260, 160), 0);
  expect(end.data.path_length).toBeGreaterThanOrEqual(end.data.displacement - 1);
  expect(end.data.all_trusted).toBe(true);
});

test('pointer paths are recorded only when the scope opts in', async ({ page, isMobile }) => {
  for (const withPath of [false, true]) {
    await openApp(page, { scope: scope(['drag'], withPath ? { pointer_path: true } : {}) });
    const driver = await pointerDriver(page, isMobile);
    const from = await atStage(page, 0.2, 0.2);
    await gesture(driver, page, from, [from[0] + 200, from[1] + 100], { ms: 200, steps: 8 });
    const paths = await eventsOf(page, 'input.pointer.path');
    if (!withPath) {
      expect(paths).toEqual([]);
    } else {
      expect(paths).toHaveLength(1);
      const { samples, gesture_id: id } = paths[0].data;
      expect(id).toBe((await eventsOf(page, 'input.drag.end'))[0].data.gesture_id);
      expect(samples.length).toBeGreaterThan(5);
      expect(samples.every((row) => row.length >= 3)).toBe(true);
    }
  }
});

test('mouse movement without a button logs nothing; with no gesture enabled no pointer events are logged', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse movement is a desktop concept');
  await openApp(page, { scope: scope([]) });
  await page.mouse.move(100, 100);
  await page.mouse.move(300, 200, { steps: 5 });
  await page.mouse.down();
  await page.mouse.up();
  expect(await eventsOf(page, 'input.')).toEqual([]);
});

test('key presses log input.key.* with the documented fields and produce no pointer events', async ({ page }) => {
  await openApp(page, { scope: scope(['tap']) });
  await page.keyboard.press('f');
  await page.keyboard.down('Shift');
  await page.keyboard.up('Shift');

  const keys = await eventsOf(page, 'input.key');
  expect(keys.map((e) => [e.type, e.data.key, e.data.code])).toEqual([
    ['input.key.down', 'f', 'KeyF'], ['input.key.up', 'f', 'KeyF'], ['input.key.down', 'Shift', 'ShiftLeft'], ['input.key.up', 'Shift', 'ShiftLeft'],
  ]);
  expect(keys.every((e) => e.data.trusted === true && e.data.repeat === false)).toBe(true);
  expect(keys.every((e) => !('consumed' in e.data))).toBe(true);
  expect(await typesOf(page, 'input.pointer')).toEqual([]);
  expect(await typesOf(page, 'input.tap')).toEqual([]);
});

test('typing into a form field is never logged', async ({ page }) => {
  await openApp(page, { scope: scope([]) });
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.id = 'answer';
    document.body.append(field);
  });
  await page.focus('#answer');
  await page.keyboard.type('secret');
  expect(await eventsOf(page, 'input.key')).toEqual([]);
  expect(await page.inputValue('#answer')).toBe('secret');
});

test('a key consumed by a rule never reaches page listeners, and is logged as consumed', async ({ page }) => {
  const rules = {
    intents: { go: { bindings: [{ key: ' ' }] } },
    rules: [{ id: 'quiet', consume: false, match: { on: 'input.key.down', where: { key: 'q' } }, emit: { event: 'semantic.q' } }],
    gestures: [],
  };
  await openApp(page, { scope: rules });
  await page.evaluate(() => {
    window.seenByPage = [];
    document.addEventListener('keydown', (e) => window.seenByPage.push(e.key));
  });
  for (const key of ['x', ' ', 'q']) await page.keyboard.press(key);

  expect(await page.evaluate(() => window.seenByPage)).toEqual(['x', 'q']);
  const downs = (await eventsOf(page, 'input.key.down')).map((e) => [e.data.key, e.data.consumed ?? false]);
  expect(downs).toEqual([['x', false], [' ', true], ['q', false]]);
  expect((await eventsOf(page, 'semantic.')).map((e) => e.type)).toEqual(['semantic.go', 'semantic.q']);
});

test('the cursor hides after 1 s without movement and returns on movement', async ({ page, isMobile }) => {
  test.skip(isMobile, 'cursor behaviour is mouse only');
  await openApp(page, { scope: scope([]) });
  await page.mouse.move(100, 100);
  await page.mouse.move(150, 120);
  expect(await page.evaluate(() => window.app.root.style.cursor)).toBe('');
  await page.waitForTimeout(1250);
  expect(await page.evaluate(() => window.app.root.style.cursor)).toBe('none');
  await page.mouse.move(151, 120);
  expect(await page.evaluate(() => window.app.root.style.cursor)).toBe('none');
  await page.mouse.move(160, 130);
  expect(await page.evaluate(() => window.app.root.style.cursor)).toBe('');
});

test('right-click does not start a gesture', async ({ page, isMobile }) => {
  test.skip(isMobile, 'mouse buttons are a desktop concept');
  await openApp(page, { scope: scope(['tap']) });
  await page.mouse.click(200, 200, { button: 'right' });
  expect(await typesOf(page, 'input.tap')).toEqual([]);
  await page.mouse.click(200, 200);
  expect(await typesOf(page, 'input.tap')).toEqual(['input.tap']);
});
