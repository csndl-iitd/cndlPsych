import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { killProfile, launchProfile, newProfileDir, removeProfileDir } from '../../tools/e2e/hard-kill.js';
import { sessionProblems } from '../../tools/validators.js';
import { unzip } from '../../tools/unzip.js';
import {
  answerConsent, answerPostTask, answerSession, answerSubject, continueDeviceScreen, finished, installAutopilot,
  passEntryScreens, startSession,
} from '../../tools/e2e/session-helpers.js';

test.setTimeout(90_000);

const STORAGE = { storage: { local: { flush_ms: 200 } } };
const NO_SINKS = { triggers: { sinks: [] } };
const FAST = { debug: { enabled: true, time_scale: 0.2 }, ...NO_SINKS, ...STORAGE };
const ofType = (events, type) => events.filter((e) => e.type === type);
const readZip = async (download) => unzip(new Uint8Array(readFileSync(await download.path())));
const parseJsonl = (text) => text.trim().split('\n').map((line) => JSON.parse(line));
const databases = (page) => page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));

/** Record every event in the page, so tests can compare what was logged with what was recovered. */
const captureLog = (page) => page.evaluate(() => {
  window.__log = [];
  window.sessionServices.bus.on('*', (event) => window.__log.push(event));
});

/**
 * A tab that goes away mid-session (closed without any unload handler). A replacement page is
 * opened first because closing the last page would close the context; it is returned.
 */
async function interrupt(context, page) {
  const replacement = await context.newPage();
  await page.close({ runBeforeUnload: false });
  return replacement;
}

/** Start a session, answer the entry screens, and stop at the first instruction page. */
async function startAndWait(page, merge = FAST) {
  await startSession(page, { local: true, merge });
  await captureLog(page);
  await passEntryScreens(page);
  await expect.poll(() => page.evaluate(() => window.sessionServices.bus.lastSeq)).toBeGreaterThan(8);
  await page.waitForTimeout(900);
  return page.evaluate(() => window.__log);
}

test('nothing is stored before consent: no database exists until the participant is eligible', async ({ page }) => {
  await startSession(page, { local: true, merge: FAST });
  await page.locator('[data-name="decision"]').waitFor();
  await page.keyboard.press('x');
  expect(await databases(page)).not.toContain('expfw');
  await answerConsent(page);
  await page.locator('[data-name="subject_id"]').waitFor();
  expect(await databases(page)).not.toContain('expfw');
  await answerSubject(page);
  await page.locator('[data-name="session_type"]').waitFor();
  expect(await databases(page)).not.toContain('expfw');
  await answerSession(page);
  await expect.poll(() => databases(page)).toContain('expfw');
});

test('declining consent or failing min_age leaves no database at all', async ({ page }) => {
  await startSession(page, { local: true, merge: FAST });
  await answerConsent(page, { agree: false });
  expect(await finished(page)).toBe('declined');
  expect(await databases(page)).not.toContain('expfw');

  await startSession(page, { local: true, merge: FAST });
  await answerConsent(page);
  await answerSubject(page, { age: '17' });
  expect(await finished(page)).toBe('ineligible');
  expect(await databases(page)).not.toContain('expfw');
});

test('a finished session is downloaded as one zip (jsonl + csv + session.json) and matches the log', async ({ page, isMobile }) => {
  test.skip(isMobile, 'a full session; the touch devices are covered elsewhere');
  await startSession(page, { local: true, merge: { ...FAST, storage: { local: { flush_ms: 200, export_on_finish: ['jsonl', 'csv', 'bids'] } } } });
  await captureLog(page);
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page);
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), answerPostTask(page)]);
  expect(await finished(page)).toBe('complete');

  expect(download.suggestedFilename()).toBe('sub-007_ses-01.zip');
  const files = await readZip(download);
  expect(Object.keys(files)).toEqual(['session.json', 'events.jsonl', 'events.csv']);
  const events = parseJsonl(files['events.jsonl']);
  const log = await page.evaluate(() => window.__log);
  const record = JSON.parse(files['session.json']);
  // The zip holds every event up to session.end; the log also saw the later storage / export notices (none after last_seq).
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  expect(events).toEqual(log.slice(0, events.length));
  expect(events.at(-1)).toMatchObject({ type: 'session.end', data: { reason: 'complete' } });
  expect(record).toMatchObject({ status: 'complete', last_seq: events.at(-1).seq, subject_id: 'sub-007' });
  expect(sessionProblems(record)).toEqual([]);
  expect(files['events.csv'].split('\r\n')).toHaveLength(events.length + 2);

  // bids is not available until M8: the log says so instead of silently ignoring it.
  expect(ofType(events, 'system.warning').map((e) => e.data.code)).toContain('export_format_unsupported');
  expect(ofType(events, 'storage.status').map((e) => e.data.state)).toEqual(['opening', 'ready']);

  // The finished session is not offered for recovery.
  const page2 = await page.context().newPage();
  await startSession(page2, { local: true, merge: FAST });
  await page2.locator('[data-name="decision"]').waitFor();
});

// A real SIGKILL of the whole browser, then a new browser on the same profile (disk).
async function killedSession({ speed }) {
  const dir = newProfileDir();
  const first = await launchProfile(dir, 'http://localhost:4173');
  const page = await first.newPage();
  const { log } = await speed(page);
  await killProfile(dir);
  const second = await launchProfile(dir, 'http://localhost:4173');
  const recovery = await second.newPage();
  return { dir, log, second, recovery };
}

test('a killed browser is recovered: gap-free log up to the last flush, closed as aborted', async ({ isMobile }) => {
  test.skip(isMobile, 'crash recovery is browser behaviour, not device specific');
  const { dir, log, second, recovery } = await killedSession({ speed: async (page) => ({ log: await startAndWait(page) }) });
  try {
    const lastSeq = log.at(-1).seq;
    await startSession(recovery, { local: true, merge: FAST });
    await recovery.locator('[data-name="action"]').waitFor();
    await expect(recovery.getByText('An unfinished session was found')).toBeVisible();
    await expect(recovery.getByText('sub-007')).toBeVisible();
    await expect(recovery.getByText(`${lastSeq + 1} events were saved`)).toBeVisible();

    const [download] = await Promise.all([recovery.waitForEvent('download'), continueDeviceScreen(recovery, 'download')]);
    expect(download.suggestedFilename()).toBe('recovered_sub-007_ses-01.zip');
    const files = await readZip(download);
    const events = parseJsonl(files['events.jsonl']);
    const record = JSON.parse(files['session.json']);

    expect(events).toEqual(log); // everything flushed before the kill is there, unchanged
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i)); // seq continuity from 0
    expect(record).toMatchObject({ status: 'aborted', end_reason: 'aborted', last_seq: lastSeq, subject_id: 'sub-007', session_id: 'ses-01' });
    expect(sessionProblems(record)).toEqual([]);
    expect(record.subject).toMatchObject({ sex: 'female', age: 24 });

    // The new session can start as usual, and the old one is not offered again.
    await recovery.locator('[data-name="decision"]').waitFor();
    const again = await second.newPage();
    await startSession(again, { local: true, merge: FAST });
    await again.locator('[data-name="decision"]').waitFor();
  } finally {
    await second.close().catch(() => {});
    removeProfileDir(dir);
  }
});

test('a kill in the middle of a block loses at most the last flush and never leaves a hole', async ({ isMobile }) => {
  test.skip(isMobile, 'crash recovery is browser behaviour, not device specific');
  const { dir, log, second, recovery } = await killedSession({
    speed: async (page) => {
      await startSession(page, { local: true, merge: FAST });
      await captureLog(page);
      await installAutopilot(page, { touch: false });
      await passEntryScreens(page);
      await expect.poll(() => page.evaluate(() => window.sessionServices.bus.context.block), { timeout: 60_000 }).toBe('oddball_task');
      await page.waitForTimeout(800);
      return { log: await page.evaluate(() => window.__log) };
    },
  });
  try {
    await startSession(recovery, { local: true, merge: FAST });
    await recovery.locator('[data-name="action"]').waitFor();
    const [download] = await Promise.all([recovery.waitForEvent('download'), continueDeviceScreen(recovery, 'download')]);
    const files = await readZip(download);
    const events = parseJsonl(files['events.jsonl']);
    const record = JSON.parse(files['session.json']);

    expect(events.length).toBeGreaterThan(300);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i)); // a prefix: no gaps
    const overlap = Math.min(events.length, log.length);
    expect(events.slice(0, overlap)).toEqual(log.slice(0, overlap)); // identical to what happened
    expect(log.length - events.length).toBeLessThan(250); // lost: roughly the last 200 ms of events
    expect(record.last_seq).toBe(events.length - 1);
    expect(sessionProblems(record)).toEqual([]);
  } finally {
    await second.close().catch(() => {});
    removeProfileDir(dir);
  }
});

test('recovery choices: delete removes the session, keep leaves it for next time', async ({ context, page, isMobile }) => {
  test.skip(isMobile, 'crash recovery is browser behaviour, not device specific');
  await startAndWait(page);
  const keeper = await interrupt(context, page);
  await startSession(keeper, { local: true, merge: FAST });
  await continueDeviceScreen(keeper, 'keep');
  await keeper.locator('[data-name="decision"]').waitFor();

  const again = await context.newPage();
  await startSession(again, { local: true, merge: FAST });
  await expect(again.getByText('An unfinished session was found')).toBeVisible();
  await continueDeviceScreen(again, 'delete');
  await again.locator('[data-name="decision"]').waitFor();

  const last = await context.newPage();
  await startSession(last, { local: true, merge: FAST });
  await last.locator('[data-name="decision"]').waitFor();
  expect(await last.evaluate(() => window.expfwStorage.createLocalStore().findUnfinished())).toEqual([]);
});

test('recovery policy auto downloads without asking; off leaves the data alone', async ({ context, page, isMobile }) => {
  test.skip(isMobile, 'crash recovery is browser behaviour, not device specific');
  const log = await startAndWait(page);
  const off = await interrupt(context, page);
  await startSession(off, { local: true, merge: { ...FAST, storage: { local: { flush_ms: 200, recovery: 'off' } } } });
  await off.locator('[data-name="decision"]').waitFor();
  expect((await off.evaluate(() => window.expfwStorage.createLocalStore().findUnfinished()))).toHaveLength(1);

  const auto = await context.newPage();
  const downloaded = auto.waitForEvent('download');
  await startSession(auto, { local: true, merge: { ...FAST, storage: { local: { flush_ms: 200, recovery: 'auto' } } } });
  const files = await readZip(await downloaded);
  expect(parseJsonl(files['events.jsonl'])).toEqual(log);
  await auto.locator('[data-name="decision"]').waitFor();
  expect(JSON.parse(files['session.json']).status).toBe('aborted');
});

test('a session that ended on its own (device rejected) is not offered for recovery', async ({ page, context }, testInfo) => {
  const allowed = testInfo.project.name === 'desktop' ? ['phone'] : ['desktop'];
  await startSession(page, { local: true, merge: { ...FAST, device: { allowed } } });
  await passEntryScreens(page);
  expect(await finished(page)).toBe('device_rejected');
  const stored = await page.evaluate(() => window.sessionResult.store.snapshot());
  expect(stored.record).toMatchObject({ status: 'device_rejected' });

  const next = await context.newPage();
  await startSession(next, { local: true, merge: FAST });
  await next.locator('[data-name="decision"]').waitFor();
});

test('hiding the page flushes what is buffered, and records page.visibility', async ({ context, page, isMobile }) => {
  test.skip(isMobile, 'tab switching is a desktop browser behaviour');
  // A flush interval of a minute: only the visibility change can have written these events.
  const slow = { ...FAST, storage: { local: { flush_ms: 60_000 } } };
  await startSession(page, { local: true, merge: slow });
  await captureLog(page);
  await passEntryScreens(page);
  await expect.poll(() => page.evaluate(() => window.sessionServices.bus.lastSeq)).toBeGreaterThan(8);

  const other = await context.newPage();
  await other.goto('/tools/e2e/session.html');
  await other.waitForFunction(() => window.sessionReady === true);
  // Headless Chromium never reports a background tab as hidden, so drive the browser's signal.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);

  const log = await page.evaluate(() => window.__log);
  const visibility = ofType(log, 'page.visibility');
  expect(visibility.at(-1).data).toEqual({ state: 'hidden' });
  const [found] = await other.evaluate(() => window.expfwStorage.createLocalStore().findUnfinished());
  expect(found.lastSeq).toBeGreaterThanOrEqual(visibility.at(-1).seq);
  const stored = await other.evaluate((key) => window.expfwStorage.createLocalStore().read(key), found.key);
  expect(stored.events.map((e) => e.seq)).toEqual(stored.events.map((_, i) => i));
});
