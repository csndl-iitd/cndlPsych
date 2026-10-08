// Eye tracking in whole sessions, in a real browser. Most tests drive a scripted stand-in for
// WebGazer (a cooperative participant who looks at the dots), because a camera and a face are
// not available here: they test what the framework does with predictions, not the accuracy of
// WebGazer. The last two tests load the real WebGazer from the bundle, with Chromium's fake
// camera (a test pattern with no face in it).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { sessionProblems } from '../../tools/validators.js';
import {
  answerPostTask, captureLog, continueDeviceScreen, finished, installAutopilot, passEntryScreens, recorded, startSession,
} from '../../tools/e2e/session-helpers.js';

test.setTimeout(180_000);
// Chromium's fake camera: only the last two tests open a camera; the others use a scripted engine.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['camera'] });

const EYE = { enabled: true, profiles: ['desktop'], sample_hz: 30, calibration: { points: 5, repeats: 1 }, validation: { points: 3, max_error_px: 100, max_retries: 1, on_fail: 'retry' }, dwell: { radius: '40px', min_ms: 100 } };
const merge = (eyetracking = {}) => ({ debug: { enabled: true, time_scale: 0.2 }, triggers: { sinks: [] }, eyetracking: { ...EYE, ...eyetracking } });
const ofType = (events, type) => events.filter((e) => e.type === type);
const gazeOffset = (page, x) => page.evaluate((dx) => { window.gazeEngine.offset = { x: dx, y: 0 }; }, x);

async function begin(page, { eyetracking, gaze = 'fake', gazeFail, local = false } = {}) {
  await startSession(page, { merge: merge(eyetracking), gaze, gazeFail, local });
  await captureLog(page);
}

/** Intro screen -> camera -> calibration intro. */
async function throughSetup(page) {
  await continueDeviceScreen(page); // "Start" on the eye tracking intro
  await continueDeviceScreen(page); // "Start" on the calibration intro
}

test('a session with eye tracking: camera consent, calibration, validation, samples, and a record that says how accurate it was', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a full session; the profile is restricted to desktop');
  await begin(page);
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page, { camera: true });
  await throughSetup(page);
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(page);
  expect(await finished(page)).toBe('complete');

  const { record, events } = await recorded(page);
  // consent: the camera statement was shown and accepted
  expect(record.consent.statements.map((s) => [s.id, s.accepted])).toEqual([['read', true], ['voluntary', true], ['camera', true]]);
  // calibration and validation, before the first block, in that order
  const types = events.map((e) => e.type);
  const firstBlock = types.indexOf('block.start');
  expect(types.indexOf('gaze.calibration')).toBeLessThan(types.indexOf('gaze.validation'));
  expect(types.indexOf('gaze.validation')).toBeLessThan(firstBlock);
  expect(ofType(events, 'gaze.calibration')[0].data).toEqual({ points: 5, repeats: 1, completed: true });
  const [validation] = ofType(events, 'gaze.validation');
  expect(validation.data).toMatchObject({ attempt: 1, points: 3, passed: true, max_error_px: 100 });
  expect(validation.data.mean_error_px).toBeLessThan(10);
  // the record carries the same numbers
  expect(record.eyetracking).toEqual({ enabled: true, engine: 'webgazer', engine_version: 'fake-1.0', validations: [{ attempt: 1, mean_error_px: validation.data.mean_error_px, passed: true, at_trial: 0 }] });
  expect(sessionProblems(record)).toEqual([]);

  // samples are recorded from the first block on, near the nominal rate, in small chunks, in stage coordinates
  const chunks = ofType(events, 'gaze.samples');
  expect(chunks.every((c) => c.seq > validation.seq)).toBe(true);
  const rows = chunks.flatMap((c) => c.data.samples);
  const seconds = (rows.at(-1)[0] - rows[0][0]) / 1000;
  expect(rows.length / seconds).toBeGreaterThan(24);
  expect(rows.length / seconds).toBeLessThan(36);
  expect(rows.every(([, x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);
  expect(Math.max(...chunks.map((c) => JSON.stringify(c).length))).toBeLessThan(10_000);
  expect(Math.max(...chunks.map((c) => c.data.samples.length))).toBeLessThanOrEqual(200);
  // fixations in the middle of the stage were found while blocks ran
  expect(ofType(events, 'input.gaze.dwell').length).toBeGreaterThan(0);
  expect(ofType(events, 'input.gaze.dwell').every((e) => e.block !== null)).toBe(true);
  // the camera is released at the end, and the preview was shown only for the setup
  expect(await page.evaluate(() => window.gazeEngine.ended)).toBe(true);
  expect(await page.evaluate(() => window.gazeEngine.previews)).toEqual([true, false]);
});

test('re-validation runs at a block boundary once enough trials have passed, and is logged with the trial count', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await begin(page, { eyetracking: { revalidate: { every_trials: 2 } } });
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page, { camera: true });
  await throughSetup(page);
  await expect.poll(() => page.evaluate(() => window.__log.filter((e) => e.type === 'gaze.validation').length), { timeout: 120_000 }).toBe(2);
  const events = await page.evaluate(() => window.__log);
  const [first, second] = ofType(events, 'gaze.validation');
  expect(second.block).toBeNull();
  expect(events.slice(0, second.seq).filter((e) => e.type === 'trial.end').length).toBeGreaterThanOrEqual(2);
  expect(ofType(events, 'gaze.calibration')).toHaveLength(1); // re-validation does not recalibrate while it passes
  expect(first.seq).toBeLessThan(second.seq);
});

test('losing the face is logged, and finding it again', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await begin(page);
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page, { camera: true });
  await throughSetup(page);
  await expect.poll(() => page.evaluate(() => window.__log.some((e) => e.type === 'block.start'))).toBe(true);
  await page.evaluate(() => { window.gazeEngine.face = false; });
  await expect.poll(() => page.evaluate(() => window.__log.some((e) => e.type === 'gaze.lost'))).toBe(true);
  await page.evaluate(() => { window.gazeEngine.face = true; });
  await expect.poll(() => page.evaluate(() => window.__log.some((e) => e.type === 'gaze.regained'))).toBe(true);
});

test('a failed validation is retried after a new calibration, and the record has both attempts', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await begin(page);
  await passEntryScreens(page, { camera: true });
  await continueDeviceScreen(page);
  await page.waitForFunction(() => window.gazeEngine !== undefined);
  await gazeOffset(page, 400);
  await continueDeviceScreen(page); // calibration intro
  await page.getByText('not accurate enough').waitFor({ timeout: 60_000 });
  await gazeOffset(page, 0);
  await continueDeviceScreen(page); // "Try again"
  await continueDeviceScreen(page); // calibration intro, second time
  await expect.poll(() => page.evaluate(() => window.__log.filter((e) => e.type === 'gaze.validation').length), { timeout: 60_000 }).toBe(2);
  const events = await page.evaluate(() => window.__log);
  expect(ofType(events, 'gaze.validation').map((e) => e.data.passed)).toEqual([false, true]);
  expect(ofType(events, 'gaze.validation')[0].data.mean_error_px).toBeCloseTo(400, -1);
  expect(ofType(events, 'gaze.calibration')).toHaveLength(2);
});

test('on_fail abort ends the session as aborted after the first failed validation', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await begin(page, { eyetracking: { validation: { ...EYE.validation, on_fail: 'abort' } } });
  await passEntryScreens(page, { camera: true });
  await continueDeviceScreen(page);
  await page.waitForFunction(() => window.gazeEngine !== undefined);
  await gazeOffset(page, 400);
  await continueDeviceScreen(page);
  expect(await finished(page)).toBe('aborted');
  const { record, events } = await recorded(page);
  expect(record).toMatchObject({ status: 'aborted', end_reason: 'aborted' });
  expect(record.eyetracking.validations).toEqual([expect.objectContaining({ attempt: 1, passed: false })]);
  expect(ofType(events, 'block.start')).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: 'session.end', data: { reason: 'aborted' } });
  expect(sessionProblems(record)).toEqual([]);
  expect(await page.evaluate(() => window.gazeEngine.ended)).toBe(true);
});

test('on_fail continue_flagged goes on, and the failure stays in the record', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop only');
  await begin(page, { eyetracking: { validation: { ...EYE.validation, on_fail: 'continue_flagged', max_retries: 0 } } });
  await passEntryScreens(page, { camera: true });
  await continueDeviceScreen(page);
  await page.waitForFunction(() => window.gazeEngine !== undefined);
  await gazeOffset(page, 400);
  await continueDeviceScreen(page);
  await expect.poll(() => page.evaluate(() => window.__log.some((e) => e.type === 'block.start')), { timeout: 60_000 }).toBe(true);
  const events = await page.evaluate(() => window.__log);
  expect(ofType(events, 'gaze.validation')[0].data.passed).toBe(false);
});

test.describe('camera denied', () => {
  test('on_denied abort (the default) ends the session and says why', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop only');
    await begin(page, { gazeFail: 'NotAllowedError' });
    await passEntryScreens(page, { camera: true });
    await continueDeviceScreen(page);
    expect(await finished(page)).toBe('aborted');
    const { record, events } = await recorded(page);
    expect(record.eyetracking).toEqual({ enabled: true, engine: 'webgazer', camera_denied: true, validations: [] });
    expect(ofType(events, 'system.warning').map((e) => e.data.code)).toContain('camera_unavailable');
    expect(ofType(events, 'block.start')).toEqual([]);
    await expect(page.getByText('needs your camera')).toBeVisible();
    expect(sessionProblems(record)).toEqual([]);
  });

  test('on_denied continue_without runs the blocks with no gaze data', async ({ page, isMobile }) => {
    test.skip(isMobile, 'a full session');
    await begin(page, { gazeFail: 'NotAllowedError', eyetracking: { camera: { on_denied: 'continue_without' } } });
    await installAutopilot(page, { touch: false });
    await passEntryScreens(page, { camera: true });
    await continueDeviceScreen(page);
    await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
    await answerPostTask(page);
    expect(await finished(page)).toBe('complete');
    const { record, events } = await recorded(page);
    expect(record.eyetracking).toMatchObject({ enabled: true, camera_denied: true });
    expect(events.filter((e) => e.source === 'gaze')).toEqual([]);
    expect(sessionProblems(record)).toEqual([]);
  });
});

test('eye tracking is skipped on a device profile it is not enabled for, and the engine is never loaded', async ({ page, isMobile }) => {
  test.skip(isMobile, 'the desktop browser runs the phone-only setting');
  await begin(page, { eyetracking: { profiles: ['phone'] } });
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page, { camera: true });
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(page);
  expect(await finished(page)).toBe('complete');
  expect(await page.evaluate(() => window.gazeEngine)).toBeUndefined();
  const { record } = await recorded(page);
  expect(record.eyetracking).toEqual({ enabled: false });
});

// ---- the real WebGazer ---------------------------------------------------------------------------
const webgazerChunks = () => readdirSync(join(import.meta.dirname, '..', '..', 'dist', 'e2e'))
  .filter((name) => name.endsWith('.js') && readFileSync(join(import.meta.dirname, '..', '..', 'dist', 'e2e', name), 'utf8').includes('loadGlobalData'));

test.describe('real WebGazer', () => {
  test('with eye tracking off (the default) nothing of WebGazer is downloaded or started', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop only');
    expect(webgazerChunks().length).toBeGreaterThan(0);
    const requested = [];
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await startSession(page, { merge: { debug: { enabled: true, time_scale: 0.2 }, triggers: { sinks: [] } }, gaze: 'real' });
    await passEntryScreens(page);
    await expect.poll(() => page.evaluate(() => window.sessionServices.bus.lastSeq)).toBeGreaterThan(8);
    expect(requested.filter((path) => webgazerChunks().some((name) => path.endsWith(name)) || path.includes('mediapipe') || path.includes('.tflite'))).toEqual([]);
    expect(await page.evaluate(() => navigator.mediaDevices.enumerateDevices().then(() => true))).toBe(true);
  });

  test('enabled: the chunk and the face model are fetched only now, the camera opens, and the fake camera (no face) fails validation honestly', async ({ page, isMobile }) => {
    test.skip(isMobile, 'desktop only');
    test.setTimeout(240_000);
    const requested = [];
    page.on('request', (request) => requested.push(new URL(request.url()).pathname));
    await begin(page, { gaze: 'real', eyetracking: { validation: { points: 3, max_error_px: 100, max_retries: 0, on_fail: 'continue_flagged' } } });
    await passEntryScreens(page, { camera: true });
    expect(requested.filter((path) => webgazerChunks().some((name) => path.endsWith(name)))).toEqual([]);
    await continueDeviceScreen(page);
    await continueDeviceScreen(page);
    await expect.poll(() => page.evaluate(() => window.__log.some((e) => e.type === 'gaze.validation')), { timeout: 150_000 }).toBe(true);
    expect(requested.some((path) => webgazerChunks().some((name) => path.endsWith(name)))).toBe(true);
    expect(requested.some((path) => path.includes('mediapipe'))).toBe(true);
    const events = await page.evaluate(() => window.__log);
    expect(ofType(events, 'gaze.calibration')).toHaveLength(1);
    const [validation] = ofType(events, 'gaze.validation');
    // the test pattern has no face, so there is nothing to measure: the validation must say so, not invent an accuracy
    expect(validation.data).toMatchObject({ passed: false, points: 0 });
    // WebGazer must not have used browser storage
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect((await page.evaluate(() => indexedDB.databases())).map((d) => d.name)).not.toContain('localforage');
  });
});
