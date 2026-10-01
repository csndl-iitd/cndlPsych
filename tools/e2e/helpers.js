// Shared helpers for browser tests: open the bundled app, read its event log, and drive
// pointers with real (trusted) input: the mouse on desktop, Chromium touch events on
// phone and tablet emulation.

/** Uncaught errors in the page (e.g. an event that fails schema validation inside a DOM handler). */
export function recordPageErrors(page) {
  page.appErrors = [];
  page.on('pageerror', (error) => page.appErrors.push(error.message));
}

export async function openApp(page, options) {
  recordPageErrors(page);
  await page.goto('/tools/e2e/app.html');
  await page.waitForFunction(() => window.appReady === true);
  await page.evaluate((o) => { window.app = window.expfw.createApp(o); }, options);
}

/** Events logged so far whose type starts with `prefix` (all events when omitted). */
export const eventsOf = (page, prefix = '') => page.evaluate((p) => window.app.events.filter((e) => e.type.startsWith(p)), prefix);

export const typesOf = async (page, prefix = '') => (await eventsOf(page, prefix)).map((e) => e.type);

export const stageRect = (page) => page.evaluate(() => window.app.stage.rect);

/** Client coordinates of a stage point (0-1 on each axis). */
export async function atStage(page, x, y) {
  const rect = await stageRect(page);
  return [rect.x + x * rect.w, rect.y + y * rect.h];
}

export async function pointerDriver(page, isMobile) {
  if (!isMobile) {
    const { mouse } = page;
    return {
      down: (x, y) => mouse.move(x, y).then(() => mouse.down()),
      move: (x, y) => mouse.move(x, y, { steps: 1 }),
      up: () => mouse.up(),
    };
  }
  const session = await page.context().newCDPSession(page);
  let last = [0, 0];
  const touch = (type, points) => session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
  return {
    down: (x, y) => { last = [x, y]; return touch('touchStart', [[x, y]]); },
    move: (x, y) => { last = [x, y]; return touch('touchMove', [[x, y]]); },
    up: () => touch('touchEnd', []),
    get last() { return last; },
  };
}

/** Press, move in `steps` over `ms`, release. */
export async function gesture(driver, page, from, to, { ms = 150, steps = 6 } = {}) {
  await driver.down(...from);
  for (let i = 1; i <= steps; i += 1) {
    await page.waitForTimeout(ms / steps);
    await driver.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  }
  await driver.up();
}

export async function tap(driver, page, x, y, holdMs = 40) {
  await driver.down(x, y);
  await page.waitForTimeout(holdMs);
  await driver.up();
}
