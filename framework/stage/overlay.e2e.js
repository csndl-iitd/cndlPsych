import { expect, test } from '@playwright/test';
import { sessionProblems } from '../../tools/validators.js';
import { answerConsent, answerSession, answerSubject, startSession } from '../../tools/e2e/session-helpers.js';

const FAST = { debug: { enabled: true, time_scale: 0.2 }, triggers: { sinks: [] } };
const rectOf = (page, selector) => page.locator(selector).first().evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
});

async function begin(page, overlay, extra = {}) {
  await startSession(page, { merge: { ...FAST, overlay, ...extra } });
  await page.locator('[data-name="decision"]').waitFor();
}

test('apriltags sit in the four corners with a white quiet zone, and the stage keeps clear of them', async ({ page }) => {
  await begin(page, { apriltags: { enabled: true, family: 'tag36h11', ids: [0, 1, 2, 3], size: '40px', margin: '4px' }, photodiode: { enabled: false } });
  const tags = await page.locator('.expfw-apriltag').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, src: el.querySelector('img').src.slice(0, 22), bg: getComputedStyle(el).backgroundColor };
  }));
  const viewport = page.viewportSize();
  expect(tags).toHaveLength(4);
  expect(tags.every((t) => t.bg === 'rgb(255, 255, 255)' && t.src === 'data:image/png;base64,')).toBe(true);
  expect(tags[0]).toMatchObject({ x: 4, y: 4 });
  expect(tags[1].right).toBeCloseTo(viewport.width - 4);
  expect(tags[2]).toMatchObject({ bottom: viewport.height - 4 });
  expect(tags[3]).toMatchObject({ x: 4 });
  // tag (40 px) + quiet zone (1 module = 5 px each side) + gap (4 px)
  expect(tags[0].w).toBeCloseTo(50);
  const stage = await rectOf(page, '.expfw-stage');
  expect(stage.x).toBeGreaterThanOrEqual(54 - 0.5);
  expect(stage.y).toBeGreaterThanOrEqual(54 - 0.5);
  expect(viewport.width - stage.right).toBeGreaterThanOrEqual(54 - 0.5);
});

test('no overlays configured: nothing is drawn and the stage uses the whole viewport', async ({ page }) => {
  await begin(page, { apriltags: { enabled: false }, photodiode: { enabled: false } });
  expect(await page.locator('.expfw-apriltag, .expfw-photodiode').count()).toBe(0);
  const stage = await rectOf(page, '.expfw-stage');
  expect(stage).toMatchObject({ x: 0, y: 0 });
});

test('the photodiode patch flips on every phase onset (toggle) and the record says where it is', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the corner geometry is checked on desktop');
  await begin(page, { apriltags: { enabled: false }, photodiode: { enabled: true, corner: 'br', size: '30px', mode: 'toggle' } });
  const colour = () => page.locator('.expfw-photodiode').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => window.sessionServices.bus.startRecording()); // the bus drops events until a session records
  expect(await colour()).toBe('rgb(0, 0, 0)');
  const box = await rectOf(page, '.expfw-photodiode');
  const viewport = page.viewportSize();
  expect(box).toMatchObject({ w: 30, h: 30, right: viewport.width, bottom: viewport.height });
  await page.evaluate(() => window.sessionServices.bus.emit({ source: 'task', type: 'phase.onset', data: { phase: 'p', planned_ms: null } }));
  expect(await colour()).toBe('rgb(255, 255, 255)');
  await page.evaluate(() => window.sessionServices.bus.emit({ source: 'task', type: 'phase.onset', data: { phase: 'p', planned_ms: null } }));
  expect(await colour()).toBe('rgb(0, 0, 0)');
  await page.evaluate(() => window.sessionServices.bus.emit({ source: 'system', type: 'system.warning', data: { code: 'x', message: 'not an onset' } }));
  expect(await colour()).toBe('rgb(0, 0, 0)');
});

test('pulse mode lights the patch for pulse_ms and then returns to black', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await begin(page, { apriltags: { enabled: false }, photodiode: { enabled: true, mode: 'pulse', pulse_ms: 120, size: '20px' } });
  const colour = () => page.locator('.expfw-photodiode').evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => window.sessionServices.bus.startRecording());
  await page.evaluate(() => window.sessionServices.bus.emit({ source: 'task', type: 'phase.onset', data: { phase: 'p', planned_ms: null } }));
  expect(await colour()).toBe('rgb(255, 255, 255)');
  await expect.poll(colour).toBe('rgb(0, 0, 0)');
});

test('the session record has the overlay positions, valid against the session schema', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await begin(page, { apriltags: { enabled: true, ids: [0, 1, 2, 3], size: '40px' }, photodiode: { enabled: true, corner: 'bl', size: '30px' } });
  await answerConsent(page);
  await answerSubject(page);
  await answerSession(page);
  await expect.poll(() => page.evaluate(() => window.sessionStore.record?.overlays !== undefined)).toBe(true);
  const { overlays, ...record } = await page.evaluate(() => window.sessionStore.record);
  expect(overlays.apriltags.family).toBe('tag36h11');
  expect(overlays.apriltags.tags.map((t) => [t.id, t.corner])).toEqual([[0, 'tl'], [1, 'tr'], [2, 'br'], [3, 'bl']]);
  expect(overlays.apriltags.tags[0]).toMatchObject({ cx: 25, cy: 25, size_px: 40 });
  expect(overlays.photodiode).toEqual({ corner: 'bl', size_px: 30 });
  expect(record.device.refresh_hz_est).toBeGreaterThan(30); // measured at the start of the session
  expect(sessionProblems({ ...record, overlays })).toEqual([]);
});

for (const corner of ['tl', 'tr', 'br', 'bl']) {
  test(`the photodiode patch beside the ${corner} tag never overlaps it: side margin on a wide screen, top / bottom margin on a tall one`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'the viewport is set by the test');
    await begin(page, { apriltags: { enabled: true, ids: [0, 1, 2, 3], size: '40px', margin: '4px' }, photodiode: { enabled: true, corner, size: '30px' } });
    const tagIndex = { tl: 0, tr: 1, br: 2, bl: 3 }[corner];
    for (const [width, height] of [[1000, 600], [500, 900]]) {
      await page.setViewportSize({ width, height });
      const settled = width > height ? (d) => (corner[1] === 'l' ? d.x : width - d.right) === 0 : (d) => (corner[0] === 't' ? d.y : height - d.bottom) === 0;
      await expect.poll(async () => settled(await rectOf(page, '.expfw-photodiode'))).toBe(true); // placed again after the resize
      const tag = await rectOf(page, `.expfw-apriltag >> nth=${tagIndex}`);
      const diode = await rectOf(page, '.expfw-photodiode');
      const tagCorner = { tl: [tag.x, tag.y], tr: [width - tag.right, tag.y], br: [width - tag.right, height - tag.bottom], bl: [tag.x, height - tag.bottom] }[corner];
      expect(tagCorner, 'the tag keeps its corner').toEqual([4, 4]);
      const apart = diode.right <= tag.x || diode.x >= tag.right || diode.bottom <= tag.y || diode.y >= tag.bottom;
      expect(apart, 'no overlap').toBe(true);
      const left = corner[1] === 'l';
      const top = corner[0] === 't';
      if (width > height) {
        expect(left ? diode.x : width - diode.right, 'in the side margin, flush with the edge').toBe(0);
        expect(top ? diode.y >= tag.bottom : diode.bottom <= tag.y, 'below a top tag, above a bottom tag').toBe(true);
      } else {
        expect(top ? diode.y : height - diode.bottom, 'in the top or bottom margin, flush with the edge').toBe(0);
        expect(left ? diode.x >= tag.right : diode.right <= tag.x, 'right of a left tag, left of a right tag').toBe(true);
      }
    }
  });
}
