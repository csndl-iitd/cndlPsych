import { expect, test } from '@playwright/test';
import { killProfile, launchProfile, newProfileDir, removeProfileDir } from '../../tools/e2e/hard-kill.js';
import { sessionProblems } from '../../tools/validators.js';
import {
  answerPostTask, captureLog, continueDeviceScreen, finished, installAutopilot, passEntryScreens, recorded, startSession, clickContinue,
} from '../../tools/e2e/session-helpers.js';

test.setTimeout(240_000);

const BASE = 'http://localhost:4173';
const SEED = 777;
const MERGE = { debug: { enabled: true, time_scale: 0.2 }, triggers: { sinks: [] }, storage: { local: { flush_ms: 200 } }, seed: SEED };
const ofType = (events, type) => events.filter((e) => e.type === type);
/** Events and record of a session on the real local store (read back from IndexedDB). */
const snapshot = (page) => page.evaluate(() => window.sessionStore.snapshot());

/** The letters shown in each oddball trial, taking the last attempt of a trial that ran twice. */
function oddballLetters(events) {
  const trials = {};
  let current = null;
  for (const event of events) {
    if (event.block !== 'oddball_task') continue;
    if (event.type === 'trial.start') {
      current = event.data.trial;
      trials[current] = [];
    } else if (event.type === 'phase.onset' && current !== null && event.data.stimulus?.startsWith('oddball_')) {
      trials[current].push(event.data.stimulus);
    }
  }
  return trials;
}

/** An uninterrupted session with the same seed, in its own browser context: the reference. */
async function referenceRun(browser) {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await startSession(page, { merge: MERGE });
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page);
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(page);
  expect(await finished(page)).toBe('complete');
  const { events } = await recorded(page);
  await context.close();
  return events;
}

/** Start a session in a profile, run until some oddball trials are done, and kill the browser. */
async function startAndKill(dir, { trialsDone }) {
  const first = await launchProfile(dir, BASE);
  const page = await first.newPage();
  await startSession(page, { local: true, merge: MERGE });
  await captureLog(page);
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page);
  await expect.poll(() => page.evaluate(() => window.__log.filter((e) => e.type === 'trial.end' && e.block === 'oddball_task').length), { timeout: 90_000 }).toBeGreaterThanOrEqual(trialsDone);
  await page.waitForTimeout(700);
  const log = await page.evaluate(() => window.__log);
  await killProfile(dir);
  return log;
}

/** Open the killed profile in a new browser, resume the session, and run it to the end. */
async function resumeAndFinish(dir, { alsoAnswerPostTask = true } = {}) {
  const second = await launchProfile(dir, BASE);
  const page = await second.newPage();
  await startSession(page, { local: true, merge: MERGE });
  await installAutopilot(page, { touch: false });
  await expect(page.getByText('It can be')).toBeVisible();
  await continueDeviceScreen(page, 'resume');
  if (alsoAnswerPostTask) {
    await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
    await answerPostTask(page);
    expect(await finished(page)).toBe('complete');
  }
  return { second, page };
}

test('a killed session is resumed where it stopped and finishes exactly like an uninterrupted one', async ({ browser, isMobile }) => {
  test.skip(isMobile, 'a full session with a browser kill; the device kind is irrelevant');
  const reference = await referenceRun(browser);
  const dir = newProfileDir();
  try {
    const log = await startAndKill(dir, { trialsDone: 2 });
    const { second, page } = await resumeAndFinish(dir);
    const { events, record } = await snapshot(page);

    // One continuous log: no gap, no repeat, identical to what had been saved before the kill.
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    const [resume] = ofType(events, 'session.resume');
    expect(ofType(events, 'session.resume')).toHaveLength(1);
    const before = resume.data.from_seq + 1;
    const overlap = Math.min(before, log.length);
    expect(events.slice(0, overlap)).toEqual(log.slice(0, overlap));
    expect(events[resume.data.from_seq].seq).toBe(resume.data.from_seq);
    expect(events.indexOf(resume)).toBeGreaterThanOrEqual(before);
    expect(events.slice(before).every((e) => e.seq >= before)).toBe(true);

    // It resumed in the oddball block, at the trial after the last finished one.
    const finishedBefore = events.slice(0, before).filter((e) => e.type === 'trial.end' && e.block === 'oddball_task').length;
    expect(finishedBefore).toBeGreaterThanOrEqual(2);
    expect(resume.data).toMatchObject({ block_id: 'oddball_task', trial: finishedBefore + 1 });

    // Nothing that was done is done again; the block is not started twice.
    expect(ofType(events, 'block.start').map((e) => e.data.block_id)).toEqual(['flash_intro', 'flash_task', 'oddball_intro', 'oddball_task', 'search_intro', 'visual_search', 'post_task']);
    expect(ofType(events, 'block.end').map((e) => e.data.reason)).toEqual(Array(7).fill('complete'));
    const ends = ofType(events, 'trial.end').filter((e) => e.block === 'oddball_task').map((e) => e.data.trial);
    expect(ends).toEqual([1, 2, 3, 4, 5]);
    expect(ofType(events, 'trial.end').filter((e) => e.block === 'visual_search')).toHaveLength(10);
    expect(ofType(events, 'form.submitted').map((e) => e.data.form_id)).toEqual(['subject', 'session', 'post_task']);

    // The seed makes the order identical: every oddball trial shows the same letters as in the uninterrupted run.
    expect(oddballLetters(events)).toEqual(oddballLetters(reference));

    // The page clock restarts: a new anchor follows, and the record says so.
    const anchors = ofType(events, 'session.clock_anchor');
    expect(anchors).toHaveLength(2);
    expect(anchors[1].data.time_origin_ms).toBeGreaterThan(anchors[0].data.time_origin_ms);
    expect(record).toMatchObject({ status: 'complete', end_reason: 'complete', subject_id: 'sub-007', last_seq: events.at(-1).seq });
    expect(record.resumes).toHaveLength(1);
    expect(record.resumes[0]).toMatchObject({ at_seq: resume.data.from_seq, block_id: 'oddball_task', trial: finishedBefore + 1, time_origin_ms: anchors[1].data.time_origin_ms });
    expect(record.experiment.seed).toBe(SEED);
    expect(sessionProblems(record)).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'session.end', data: { reason: 'complete' } });
    await second.close();
  } finally {
    removeProfileDir(dir);
  }
});

test('a session can be resumed more than once', async ({ isMobile }) => {
  test.skip(isMobile, 'a full session with two browser kills');
  const dir = newProfileDir();
  try {
    await startAndKill(dir, { trialsDone: 1 });
    // Resume, let it get a little further, kill again.
    const second = await launchProfile(dir, BASE);
    const page = await second.newPage();
    await startSession(page, { local: true, merge: MERGE });
    await captureLog(page);
    await installAutopilot(page, { touch: false });
    await continueDeviceScreen(page, 'resume');
    await expect.poll(() => page.evaluate(() => window.__log.filter((e) => e.type === 'trial.end').length), { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(700);
    await killProfile(dir);

    const { second: third, page: last } = await resumeAndFinish(dir);
    const { events, record } = await snapshot(last);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(ofType(events, 'session.resume')).toHaveLength(2);
    expect(record.resumes).toHaveLength(2);
    expect(record.resumes[1].at_seq).toBeGreaterThan(record.resumes[0].at_seq);
    expect(ofType(events, 'trial.end').filter((e) => e.block === 'oddball_task').map((e) => e.data.trial)).toEqual([1, 2, 3, 4, 5]);
    expect(record.status).toBe('complete');
    expect(sessionProblems(record)).toEqual([]);
    await third.close();
  } finally {
    removeProfileDir(dir);
  }
});

test('a session whose experiment files changed cannot be resumed (it can still be downloaded)', async ({ context, page, isMobile }) => {
  test.skip(isMobile, 'tab handling is browser behaviour');
  await startSession(page, { local: true, merge: MERGE });
  await captureLog(page);
  await passEntryScreens(page);
  await expect.poll(() => page.evaluate(() => window.sessionServices.bus.lastSeq)).toBeGreaterThan(8);
  await page.waitForTimeout(700);
  const next = await context.newPage();
  await page.close({ runBeforeUnload: false });

  await startSession(next, { local: true, merge: { ...MERGE, name: 'A different experiment' } });
  await expect(next.getByText('An unfinished session was found')).toBeVisible();
  await expect(next.getByText('cannot be resumed')).toBeVisible();
  await expect(next.getByText('have changed')).toBeVisible();
  await expect(next.locator('[data-name="action"] label:has(input[value="resume"])')).toHaveCount(0);
  await expect(next.locator('[data-name="action"] label:has(input[value="download"])')).toHaveCount(1);
});

test('an aborted session (already downloaded) is resumed from the local data screen', async ({ context, page, isMobile }) => {
  test.skip(isMobile, 'a full session; the device kind is irrelevant');
  await startSession(page, { local: true, merge: MERGE });
  await captureLog(page);
  await passEntryScreens(page);
  await expect.poll(() => page.evaluate(() => window.sessionServices.bus.lastSeq)).toBeGreaterThan(8);
  await page.waitForTimeout(700);
  const log = await page.evaluate(() => window.__log);
  const second = await context.newPage();
  await page.close({ runBeforeUnload: false });

  // Download offered data: this closes the session as aborted, and it is no longer offered at start-up.
  await startSession(second, { local: true, merge: MERGE });
  await Promise.all([second.waitForEvent('download'), continueDeviceScreen(second, 'download')]);
  await second.locator('[data-name="decision"]').waitFor();

  const manager = await context.newPage();
  await startSession(manager, { query: '?manage=1', local: true, merge: MERGE });
  await installAutopilot(manager, { touch: false });
  await manager.locator('[data-name="selected"]').waitFor();
  await expect(manager.getByText('aborted - can be resumed')).toBeVisible();
  await manager.locator('[data-name="selected"] label', { hasText: 'sub-007' }).click();
  await manager.locator('[data-name="action"] label:has(input[value="resume"])').click();
  await clickContinue(manager);

  await manager.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(manager);
  expect(await finished(manager)).toBe('complete');
  const { events, record } = await snapshot(manager);
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  expect(events.slice(0, log.length)).toEqual(log); // everything saved before the interruption is unchanged
  expect(ofType(events, 'session.resume')).toHaveLength(1);
  expect(record).toMatchObject({ status: 'complete', subject_id: 'sub-007' });
  expect(record.resumes).toHaveLength(1);
  expect(sessionProblems(record)).toEqual([]);
});
