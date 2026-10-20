// The webcam recording, in a real browser with Chromium's fake camera (a moving test pattern). The
// video is written to a file through the File System Access API; the save dialog cannot be driven by
// a test, so the tests answer it with a file in the page's private file system (OPFS), which goes
// through the same FileSystemFileHandle / createWritable calls. A real camera, the real save dialog,
// other browsers and phones were not tried.
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
test.beforeEach(async ({ page, isMobile }) => {
  test.skip(isMobile, 'Chromium fake camera, run once on the desktop browser');
  await page.addInitScript(() => {
    window.__pickerCalls = [];
    window.showSaveFilePicker = async (options) => {
      window.__pickerCalls.push(options);
      return (await navigator.storage.getDirectory()).getFileHandle(options.suggestedName, { create: true });
    };
  });
});
test.afterEach(async () => {
  await served?.close();
  if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
  dir = null;
  served = null;
});

/** A fresh project with `webcam` switched on (extra YAML lines appended to experiment.yaml) and a short task. */
async function project(webcamYaml = '  enabled: true\n  chunk_s: 1\n') {
  dir = join(mkdtempSync(join(tmpdir(), 'cndlpsych-webcam-')), 'study');
  initProject(dir);
  const experiment = join(dir, 'experiment.yaml');
  writeFileSync(experiment, `${readFileSync(experiment, 'utf8')}\nwebcam:\n${webcamYaml}`);
  const timeline = join(dir, 'timeline.yaml');
  writeFileSync(timeline, readFileSync(timeline, 'utf8').replace('repetitions: 10', 'repetitions: 2'));
  served = await serveDirectory({ dir });
  return served.url;
}

const choose = (page, name, value) => page.locator(`[data-name="${name}"] label:has(input[value="${value}"])`).click();
const events = (page) => page.evaluate(async () => (await window.cndlpsych.store.snapshot()).events);
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
  await page.evaluate(() => { window.cndlpsych.finished.then((result) => { window.__result = result; }); });
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline && !(await page.evaluate(() => window.__result !== undefined))) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
  }
  return page.evaluate(() => window.__result);
}

/** Every download the page starts. */
function collectDownloads(page) {
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  return downloads;
}

/** A file in the page's private file system: its size and first bytes. */
const savedFile = (page, name) => page.evaluate(async (fileName) => {
  const file = await (await (await navigator.storage.getDirectory()).getFileHandle(fileName)).getFile();
  return { size: file.size, head: [...new Uint8Array(await file.slice(0, 4).arrayBuffer())] };
}, name);

test('the video is appended to one file the participant chose; the zip does not hold it, and the browser keeps no copy', async ({ page }) => {
  const downloads = collectDownloads(page);
  await toCameraScreen(page, await project());
  await startRecording(page);
  await page.getByText('Reaction time').waitFor();
  await playToTheEnd(page);

  const picked = await page.evaluate(() => window.__pickerCalls);
  expect(picked).toHaveLength(1);
  expect(picked[0]).toMatchObject({ suggestedName: 'sub-001_ses-01_webcam.webm', types: [{ accept: { 'video/webm': ['.webm'] } }] });

  const log = await events(page);
  const types = log.map((e) => e.type);
  const start = log.find((e) => e.type === 'webcam.start');
  const stop = log.find((e) => e.type === 'webcam.stop');
  expect(start.data).toMatchObject({ segment: 1, audio: false, save: 'file', file: 'sub-001_ses-01_webcam.webm' });
  expect(types.indexOf('webcam.stop')).toBeLessThan(types.indexOf('session.end'));
  expect(types.indexOf('webcam.start')).toBeLessThan(types.indexOf('block.start'));
  const chunks = ofType(log, 'webcam.chunk');
  expect(chunks.length).toBeGreaterThanOrEqual(3); // pieces of 1 s over a session of several seconds
  expect(stop.data).toMatchObject({ segment: 1, reason: 'session_end', chunks: chunks.length, bytes: chunks.reduce((sum, e) => sum + e.data.bytes, 0) });
  expect(ofType(log, 'webcam.error')).toEqual([]);

  // the file on disk is complete: as big as the pieces, a WebM, and the browser can play it
  const file = await savedFile(page, 'sub-001_ses-01_webcam.webm');
  expect(file.size).toBe(stop.data.bytes);
  expect(file.head).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  const size = await page.evaluate(async () => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle('sub-001_ses-01_webcam.webm');
    const element = document.createElement('video');
    return new Promise((resolve, reject) => {
      element.onloadedmetadata = () => resolve({ w: element.videoWidth, h: element.videoHeight });
      element.onerror = () => reject(new Error('the video could not be played'));
      handle.getFile().then((blob) => { element.src = URL.createObjectURL(blob); });
    });
  });
  expect(size.w).toBeGreaterThan(0);
  expect(await page.evaluate(async () => (await window.cndlpsych.store.readMedia()).length)).toBe(0); // nothing kept in the browser

  // the zip has the data and no video, and nothing else was downloaded
  await expect.poll(() => downloads.length).toBe(1);
  const files = unzipBytes(new Uint8Array(readFileSync(await downloads[0].path())));
  expect(Object.keys(files).some((name) => name.startsWith('webcam'))).toBe(false);
  const record = JSON.parse(new TextDecoder().decode(files['session.json']));
  expect(record.webcam).toMatchObject({ enabled: true, save: 'file', file: 'sub-001_ses-01_webcam.webm', segments: 1, chunks: chunks.length, bytes: stop.data.bytes, errors: 0 });
  expect(record.webcam.video.width).toBeGreaterThan(0);
  expect(record.consent.statements.map((s) => s.id)).toContain('webcam');
});

test('save: browser keeps the video in the browser and downloads it as its own file, apart from the zip', async ({ page }) => {
  const downloads = collectDownloads(page);
  await toCameraScreen(page, await project('  enabled: true\n  chunk_s: 1\n  save: browser\n'));
  await startRecording(page);
  await page.getByText('Reaction time').waitFor();
  await playToTheEnd(page);
  expect(await page.evaluate(() => window.__pickerCalls)).toEqual([]); // no dialog

  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.map((d) => d.suggestedFilename()).sort()).toEqual(['sub-001_ses-01.zip', 'sub-001_ses-01_webcam.webm']);
  const video = readFileSync(await downloads.find((d) => d.suggestedFilename().endsWith('.webm')).path());
  const stop = ofType(await events(page), 'webcam.stop')[0];
  expect(video.length).toBe(stop.data.bytes);
  expect([...video.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  const files = unzipBytes(new Uint8Array(readFileSync(await downloads.find((d) => d.suggestedFilename().endsWith('.zip')).path())));
  expect(Object.keys(files).some((name) => name.startsWith('webcam'))).toBe(false);
  expect(JSON.parse(new TextDecoder().decode(files['session.json'])).webcam).toMatchObject({ save: 'browser', segments: 1 });
});

test('on a browser with no save dialog, auto falls back to keeping the video in the browser', async ({ page }) => {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await toCameraScreen(page, await project());
  await startRecording(page);
  await page.getByText('Reaction time').waitFor();
  expect(ofType(await events(page), 'webcam.start')[0].data.save).toBe('browser');
});

test('save: file without a save dialog in the browser ends the session as aborted', async ({ page }) => {
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await toCameraScreen(page, await project('  enabled: true\n  save: file\n'));
  await startRecording(page);
  await expect(page.getByText('needs to record with your camera')).toBeVisible();
  const log = await events(page);
  expect(ofType(log, 'webcam.error').map((e) => e.data.code)).toEqual(['unsupported']);
  expect(ofType(log, 'session.end')[0].data.reason).toBe('aborted');
});

test('a cancelled save dialog is a refused recording: the session ends as aborted', async ({ page }) => {
  await page.addInitScript(() => {
    window.showSaveFilePicker = async () => { throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }); };
  });
  await toCameraScreen(page, await project());
  await startRecording(page);
  await expect(page.getByText('needs to record with your camera')).toBeVisible();
  expect(ofType(await events(page), 'webcam.error').map((e) => e.data.code)).toEqual(['file_declined']);
});

test('a resumed session records a second video file after the first', async ({ page }) => {
  await toCameraScreen(page, await project());
  await startRecording(page);
  await page.getByText('Reaction time').waitFor();
  await expect.poll(async () => ofType(await events(page), 'webcam.chunk').length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  await page.reload(); // the page goes away in the middle of the recording

  await page.getByText('An unfinished session was found').waitFor();
  await choose(page, 'action', 'resume');
  await clickContinue(page);
  await startRecording(page); // the camera screen again
  await page.getByText('Reaction time').waitFor();
  await playToTheEnd(page);

  const log = await events(page);
  expect(ofType(log, 'webcam.start').map((e) => e.data.segment)).toEqual([1, 2]);
  expect(ofType(log, 'webcam.stop').map((e) => e.data.segment)).toEqual([2]); // the first recording ended with the page
  // the second file is named so that it does not replace the first
  expect(await page.evaluate(() => window.__pickerCalls.map((call) => call.suggestedName))).toEqual(['sub-001_ses-01_webcam-2.webm']);
  expect((await savedFile(page, 'sub-001_ses-01_webcam-2.webm')).head).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
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
