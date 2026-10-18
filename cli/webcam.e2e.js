// The webcam recording, in a real browser with Chromium's fake camera (a moving test pattern): the
// participant is asked, the video is kept in the browser while it is recorded and lands in the
// exported zip, the log says when it started and stopped, and a refused camera ends the session or not
// as the experiment says. A real camera, other browsers and phones were not tried.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { clickContinue } from '../tools/e2e/session-helpers.js';
import { unzipBytes } from '../tools/unzip.js';
import { initProject } from './init.js';
import { serveDirectory } from './serve.js';

test.setTimeout(150_000);
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }, permissions: ['camera', 'microphone'] });

let dir;
let served;
test.beforeEach(({ isMobile }) => test.skip(isMobile, 'Chromium fake camera, run once on the desktop browser'));
test.afterEach(async () => {
  await served?.close();
  if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
  dir = null;
  served = null;
});

/** A fresh project with `webcam` switched on (extra YAML lines appended to experiment.yaml) and a short task. */
async function project(webcamYaml = '  enabled: true\n  chunk_s: 1\n') {
  dir = join(mkdtempSync(join(tmpdir(), 'expfw-webcam-')), 'study');
  initProject(dir);
  const experiment = join(dir, 'experiment.yaml');
  writeFileSync(experiment, `${readFileSync(experiment, 'utf8')}\nwebcam:\n${webcamYaml}`);
  const timeline = join(dir, 'timeline.yaml');
  writeFileSync(timeline, readFileSync(timeline, 'utf8').replace('repetitions: 10', 'repetitions: 2'));
  served = await serveDirectory({ dir });
  return served.url;
}

const choose = (page, name, value) => page.locator(`[data-name="${name}"] label:has(input[value="${value}"])`).click();
const events = (page) => page.evaluate(async () => (await window.expfw.store.snapshot()).events);
const ofType = (list, type) => list.filter((e) => e.type === type);

async function toCameraScreen(page, url) {
  await page.goto(url);
  await page.locator('[data-name="decision"]').waitFor();
  await choose(page, 'decision', 'agree');
  await expect(page.locator('[data-name="statement_webcam"]')).toBeVisible(); // the consent mentions the recording
  for (const id of ['read', 'voluntary', 'webcam']) await choose(page, `statement_${id}`, 'yes');
  await clickContinue(page);
  await page.locator('[data-name="subject_id"] input').fill('001');
  await choose(page, 'sex', 'female');
  await page.locator('[data-name="age"] input').fill('30');
  await clickContinue(page);
  await clickContinue(page); // the session form
}

const startRecording = async (page) => {
  await expect(page.getByText('Camera recording')).toBeVisible();
  await choose(page, 'action', 'go');
  await clickContinue(page);
};

/** Press SPACE every so often until the session has finished (the instructions and each circle). */
async function playToTheEnd(page) {
  await page.evaluate(() => { window.expfw.finished.then((result) => { window.__result = result; }); });
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline && !(await page.evaluate(() => window.__result !== undefined))) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
  }
  return page.evaluate(() => window.__result);
}

test('the participant is asked, the video is recorded in pieces, and the exported zip holds it next to the log', async ({ page }) => {
  const url = await project();
  await toCameraScreen(page, url);
  await startRecording(page);
  await page.getByText('Reaction time').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), playToTheEnd(page)]);

  const log = await events(page);
  const types = log.map((e) => e.type);
  const start = log.find((e) => e.type === 'webcam.start');
  const stop = log.find((e) => e.type === 'webcam.stop');
  expect(start.data).toMatchObject({ segment: 1, audio: false });
  expect(start.data.mime).toMatch(/^video\/webm/);
  expect(types.indexOf('webcam.stop')).toBeLessThan(types.indexOf('session.end'));
  expect(types.indexOf('webcam.start')).toBeLessThan(types.indexOf('block.start'));
  const chunks = ofType(log, 'webcam.chunk');
  expect(chunks.length).toBeGreaterThanOrEqual(3); // pieces of 1 s over a session of several seconds
  expect(chunks.map((e) => e.data.index)).toEqual(chunks.map((_, i) => i));
  expect(stop.data).toMatchObject({ segment: 1, reason: 'session_end', chunks: chunks.length });
  expect(stop.data.bytes).toBe(chunks.reduce((sum, e) => sum + e.data.bytes, 0));
  expect(ofType(log, 'webcam.error')).toEqual([]);

  const files = unzipBytes(new Uint8Array(readFileSync(await download.path())));
  const video = files['webcam/001_ses-01_segment-1.webm'] ?? files[Object.keys(files).find((name) => name.startsWith('webcam/'))];
  expect(video, Object.keys(files).join(', ')).toBeDefined();
  expect(video.length).toBe(stop.data.bytes);
  expect([...video.slice(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]); // the start of a WebM file
  // and the browser can play it: it knows the picture size
  const size = await page.evaluate((bytes) => new Promise((resolve, reject) => {
    const element = document.createElement('video');
    element.onloadedmetadata = () => resolve({ w: element.videoWidth, h: element.videoHeight });
    element.onerror = () => reject(new Error('the video could not be played'));
    element.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }));
  }), [...video]);
  expect(size.w).toBeGreaterThan(0);

  const record = JSON.parse(new TextDecoder().decode(files['session.json']));
  expect(record.webcam).toMatchObject({ enabled: true, segments: 1, chunks: chunks.length, bytes: stop.data.bytes, audio: false, errors: 0 });
  expect(record.webcam.video.width).toBeGreaterThan(0);
  expect(record.consent.statements.map((s) => s.id)).toContain('webcam');
});

test('a resumed session records a second video file after the first, and the zip holds both', async ({ page }) => {
  const url = await project();
  await toCameraScreen(page, url);
  await startRecording(page);
  await page.getByText('Reaction time').waitFor();
  await expect.poll(async () => ofType(await events(page), 'webcam.chunk').length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await page.reload(); // the page goes away in the middle of the recording

  await page.getByText('An unfinished session was found').waitFor();
  await choose(page, 'action', 'resume');
  await clickContinue(page);
  await startRecording(page); // the camera screen again
  await page.getByText('Reaction time').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), playToTheEnd(page)]);

  const log = await events(page);
  expect(ofType(log, 'webcam.start').map((e) => e.data.segment)).toEqual([1, 2]);
  expect(ofType(log, 'webcam.stop').map((e) => e.data.segment)).toEqual([2]); // the first recording ended with the page
  const files = unzipBytes(new Uint8Array(readFileSync(await download.path())));
  const names = Object.keys(files).filter((name) => name.startsWith('webcam/'));
  expect(names.map((name) => name.replace(/^.*_(segment-\d)\..*$/, '$1'))).toEqual(['segment-1', 'segment-2']);
  expect(names.every((name) => files[name].length > 1000 && files[name][0] === 0x1a)).toBe(true);
});

test('a refused camera ends the session as aborted, and says so', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); };
  });
  await toCameraScreen(page, await project());
  await startRecording(page);
  await expect(page.getByText('needs to record with your camera')).toBeVisible();
  const log = await events(page);
  expect(ofType(log, 'webcam.error').map((e) => e.data.code)).toEqual(['denied']);
  expect(ofType(log, 'session.end')[0].data.reason).toBe('aborted');
});

test('with on_denied: continue_without the session goes on and the record says the camera was not used', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); };
  });
  await toCameraScreen(page, await project('  enabled: true\n  on_denied: continue_without\n'));
  await startRecording(page);
  await page.getByText('Reaction time').waitFor();
  const result = await playToTheEnd(page);
  expect(result.status).toBe('complete');
  expect(result.record.webcam).toMatchObject({ enabled: true, camera_denied: true, errors: 1 });
});

test('a device whose profile is not listed takes part without the recording', async ({ page }) => {
  await page.goto(await project('  enabled: true\n  profiles: [phone]\n'));
  await page.locator('[data-name="decision"]').waitFor();
  await choose(page, 'decision', 'agree');
  for (const id of ['read', 'voluntary', 'webcam']) await choose(page, `statement_${id}`, 'yes');
  await clickContinue(page);
  await page.locator('[data-name="subject_id"] input').fill('001');
  await choose(page, 'sex', 'female');
  await page.locator('[data-name="age"] input').fill('30');
  await clickContinue(page);
  await clickContinue(page);
  await page.getByText('Reaction time').waitFor(); // no camera screen in between
  expect(ofType(await events(page), 'webcam.start')).toEqual([]);
});
