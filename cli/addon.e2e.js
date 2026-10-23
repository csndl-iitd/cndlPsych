// The eye tracking add-on is a separate, GPL-licensed folder next to the MIT-licensed core:
// without it eye tracking stops with a clear message; with it, WebGazer is fetched from it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { answerConsent, answerSubject, clickContinue, continueDeviceScreen } from '../tools/e2e/session-helpers.js';
import { quietMode } from '../tools/e2e/project.js';
import { initProject } from './init.js';
import { serveDirectory } from './serve.js';
import { validateProject } from './validate.js';

test.setTimeout(240_000);
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['camera'] });

const EYE = `
eyetracking:
  enabled: true
  calibration: { points: 5, repeats: 1 }
  validation: { points: 3, max_retries: 0, on_fail: continue_flagged }
`;

let dir;
test.beforeEach(({ isMobile }) => { test.skip(isMobile, 'one run is enough'); });
test.afterEach(() => { if (dir) rmSync(join(dir, '..'), { recursive: true, force: true }); dir = null; });

function project({ eyetracking }) {
  dir = join(mkdtempSync(join(tmpdir(), 'cndlpsych-addon-')), 'study');
  initProject(dir, { eyetracking });
  quietMode(dir);
  const file = join(dir, 'experiment.yaml');
  writeFileSync(file, readFileSync(file, 'utf8') + EYE);
}

/** Consent (with the camera statement), subject form, session form. */
async function enter(page) {
  await answerConsent(page, { camera: true });
  await answerSubject(page, { id: '001' });
  await clickContinue(page);
}

test('validate warns when eye tracking is on but the add-on folder is missing, and not when it is there', async () => {
  project({ eyetracking: false });
  const without = await validateProject(dir);
  expect(without.diagnostics.map((d) => d.code)).toEqual(['eyetracking-addon-missing']);
  expect(without.ok).toBe(true);
  project({ eyetracking: true });
  expect((await validateProject(dir)).diagnostics).toEqual([]);
});

test('without the add-on the session stops at the eye tracking step, says why, and nothing of WebGazer was fetched', async ({ page }) => {
  project({ eyetracking: false });
  const requested = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  const served = await serveDirectory({ dir });
  try {
    await page.goto(served.url);
    await enter(page);
    await continueDeviceScreen(page); // "Start" on the eye tracking intro
    await continueDeviceScreen(page, 'stop'); // the add-on is missing: an experimenter may continue without eye tracking or stop
    await expect(page.getByText('its software is not installed')).toBeVisible();
    const events = await page.evaluate(async () => (await window.cndlpsych.store.snapshot()).events);
    expect(events.find((e) => e.type === 'system.error')?.data.code).toBe('eyetracking_addon_missing');
    expect(events.at(-1)).toMatchObject({ type: 'session.end', data: { reason: 'aborted' } });
    expect(requested.filter((path) => path.includes('cndlpsych-eyetracking') && path.endsWith('.js'))).toEqual(['/cndlpsych-eyetracking/webgazer.js']); // it looked, and found nothing
  } finally {
    await served.close();
  }
});

test('with the add-on, WebGazer and the face model come from that folder; the core folder holds no WebGazer', async ({ page }) => {
  project({ eyetracking: true });
  const requested = [];
  page.on('request', (request) => requested.push(new URL(request.url()).pathname));
  const served = await serveDirectory({ dir });
  try {
    await page.goto(served.url);
    await enter(page);
    expect(requested.some((path) => path.startsWith('/cndlpsych-eyetracking/'))).toBe(false); // not before it is needed
    await continueDeviceScreen(page);
    await continueDeviceScreen(page); // calibration intro
    await expect.poll(() => page.evaluate(async () => (await window.cndlpsych.store.snapshot()).events.some((e) => e.type === 'gaze.validation')), { timeout: 150_000 }).toBe(true);
    expect(requested).toContain('/cndlpsych-eyetracking/webgazer.js');
    expect(requested.some((path) => path.startsWith('/cndlpsych-eyetracking/mediapipe/'))).toBe(true);
    expect(requested.filter((path) => path.startsWith('/cndlpsych/') && path.endsWith('.js')).length).toBeGreaterThan(0);
    expect(requested.some((path) => path.startsWith('/cndlpsych-eyetracking/') && path.includes('/cndlpsych/'))).toBe(false);
  } finally {
    await served.close();
  }
});

test('the Firebase SDK file in cndlpsych/vendor loads in a browser and exports the SDK', async ({ page }) => {
  project({ eyetracking: false });
  const served = await serveDirectory({ dir });
  try {
    await page.goto(served.url);
    const names = await page.evaluate(async () => Object.keys(await import('/cndlpsych/vendor/firebase.js')));
    expect(names).toEqual(expect.arrayContaining(['initializeApp', 'getFirestore', 'writeBatch', 'runTransaction', 'getAuth', 'signInAnonymously', 'initializeAppCheck']));
  } finally {
    await served.close();
  }
});
