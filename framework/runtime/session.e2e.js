import { expect, test } from '@playwright/test';
import { sessionProblems } from '../../tools/validators.js';
import {
  answerConsent, answerPostTask, answerSession, answerSubject, finished, installAutopilot, passEntryScreens, recorded, startSession,
} from '../../tools/e2e/session-helpers.js';

test.afterEach(({ page }) => {
  expect(page.appErrors ?? []).toEqual([]);
});

test.setTimeout(180_000);

// These tests are about the session, not hardware: the example's trigger sinks are removed.
const FAST = { debug: { enabled: true, time_scale: 0.2 }, triggers: { sinks: [] } };
const ofType = (events, type) => events.filter((e) => e.type === type);
const profileOf = (testInfo) => testInfo.project.name;

async function runFullSession(page, isMobile, merge = FAST) {
  await startSession(page, { merge });
  await installAutopilot(page, { touch: isMobile });
  await passEntryScreens(page);
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(page, { difficulty: '4', strategy: 'No' });
  expect(await finished(page)).toBe('complete');
  return recorded(page);
}

test('the example project runs end to end: oddball, flashes and visual search', async ({ page, isMobile }, testInfo) => {
  const { events, record } = await runFullSession(page, isMobile);

  // The log starts with session.start at seq 0 and has no gaps.
  expect(events[0]).toMatchObject({ type: 'session.start', seq: 0, source: 'system' });
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  expect(events.slice(0, 7).map((e) => e.type)).toEqual([
    'session.start', 'session.clock_anchor', 'system.warning', 'device.profile', 'consent.accepted', 'form.submitted', 'form.submitted',
  ]);
  expect(events[3].data).toMatchObject({ profile: profileOf(testInfo), reason: 'auto' });

  // Blocks run in order and all complete; the survey block runs because session_type is Experimental.
  const blocks = ofType(events, 'block.start').map((e) => e.data.block_id);
  expect(blocks).toEqual(['flash_intro', 'flash_task', 'oddball_intro', 'oddball_task', 'search_intro', 'visual_search', 'post_task']);
  expect(ofType(events, 'block.end').map((e) => e.data.reason)).toEqual(Array(7).fill('complete'));

  // Trial numbers are 1-based within each block.
  const trials = (block) => ofType(events, 'trial.start').filter((e) => e.block === block).map((e) => e.data.trial);
  expect(trials('flash_task')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(trials('oddball_task')).toEqual([1, 2, 3, 4, 5]);
  expect(trials('visual_search')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  expect(ofType(events, 'trial.start').every((e) => e.trial === e.data.trial && e.block !== null)).toBe(true);

  // Every phase.onset has a matching phase.offset; stimulus phases carry their stimulus.
  const onsets = ofType(events, 'phase.onset');
  const offsets = ofType(events, 'phase.offset');
  expect(onsets.length).toBe(offsets.length);
  for (const [i, onset] of onsets.entries()) {
    expect(offsets[i].data.phase).toBe(onset.data.phase);
    expect(offsets[i].data.stimulus).toBe(onset.data.stimulus);
    expect(offsets[i].t).toBeGreaterThanOrEqual(onset.t);
    expect(onset.phase).toBe(onset.data.phase);
  }
  const flashPhases = onsets.filter((e) => e.block === 'flash_task' && e.data.stimulus);
  expect(flashPhases.map((e) => e.data.stimulus)).toEqual(Array.from({ length: 10 }, () => ['flash_black', 'flash_white']).flat());
  expect(flashPhases.every((e) => e.trial >= 1 && e.data.planned_ms === 50)).toBe(true);

  // Oddball: 5 trials of 20 shuffled letters; the second oddball_Ǝ is answered in each.
  const oddball = onsets.filter((e) => e.block === 'oddball_task' && e.data.stimulus?.startsWith('oddball_'));
  expect(oddball).toHaveLength(100);
  expect(onsets.filter((e) => e.data.phase === 'start' && e.block === 'oddball_task')).toHaveLength(5);
  const evaluated = ofType(events, 'response.evaluated').filter((e) => e.block === 'oddball_task');
  expect(evaluated.filter((e) => e.data.correct === true)).toHaveLength(5);
  expect(evaluated.every((e) => e.data.correct === true || e.data.intent === null || e.data.stimulus !== 'oddball_Ǝ')).toBe(true);
  expect(evaluated.filter((e) => e.data.correct === true).every((e) => e.data.occurrence === 2 && e.data.stimulus === 'oddball_Ǝ')).toBe(true);

  // Visual search: the custom generator reports its data, and `next` ends every trial.
  const search = onsets.filter((e) => e.data.stimulus === 'search_array');
  expect(search).toHaveLength(10);
  expect(search[0].data.stimulus_data.items).toHaveLength(12);
  expect(ofType(events, 'semantic.next')).toHaveLength(10);
  expect(ofType(events, 'bridge.key_injected').filter((e) => e.data.intent === 'next')).toHaveLength(10);
  expect(ofType(events, 'trial.end').filter((e) => e.block === 'visual_search').map((e) => e.data.outcome)).toEqual(Array(10).fill('completed'));

  // The survey block records its answers; the built-in forms record none (they live in the session record).
  const forms = ofType(events, 'form.submitted');
  expect(forms.map((e) => e.data.form_id)).toEqual(['subject', 'session', 'post_task']);
  expect(forms[0].data).not.toHaveProperty('values');
  expect(forms[2].data.values).toMatchObject({ difficulty: 4, strategy: 'No' });

  expect(events.at(-1)).toMatchObject({ type: 'session.end', data: { reason: 'complete' } });

  // The session record validates and matches what was entered.
  expect(sessionProblems(record)).toEqual([]);
  expect(record).toMatchObject({
    status: 'complete', end_reason: 'complete', subject_id: 'sub-007', session_id: 'ses-01', last_seq: events.at(-1).seq,
    subject: { sex: 'female', age: 24, handedness: 'right' },
    session_fields: { session_type: 'Experimental' },
    device: { profile: profileOf(testInfo), profile_reason: 'auto' },
  });
  expect(record.consent.statements).toEqual([{ id: 'read', accepted: true }, { id: 'voluntary', accepted: true }]);
  expect(record.experiment.custom_modules.map((m) => m.name)).toEqual(['search_array']);
  expect(record.experiment.spec_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
});

test('the consent gate persists nothing before acceptance', async ({ page }) => {
  await startSession(page, { merge: FAST });
  const state = () => page.evaluate(() => ({
    recording: window.sessionServices.bus.recording, lastSeq: window.sessionServices.bus.lastSeq,
    persisted: window.sessionServices.bus.recording, stored: window.sessionResult?.store?.events.length ?? 0,
  }));
  await page.locator('[data-name="decision"]').waitFor();
  // Interacting with the consent page (keys, clicks) records nothing.
  await page.keyboard.press('x');
  await page.mouse.click(10, 10);
  expect(await state()).toMatchObject({ recording: false, lastSeq: -1 });

  await answerConsent(page);
  await page.locator('[data-name="subject_id"]').waitFor();
  expect(await state()).toMatchObject({ recording: false, lastSeq: -1 });
  await answerSubject(page);
  await page.locator('[data-name="session_type"]').waitFor();
  expect(await state()).toMatchObject({ recording: false, lastSeq: -1 });

  await answerSession(page);
  await expect.poll(async () => (await state()).recording).toBe(true);
});

test('declining consent ends the session with nothing stored', async ({ page }) => {
  await startSession(page, { merge: FAST });
  await answerConsent(page, { agree: false });
  expect(await finished(page)).toBe('declined');
  const stored = await page.evaluate(() => ({ lastSeq: window.sessionServices.bus.lastSeq, store: window.sessionResult.store }));
  expect(stored.lastSeq).toBe(-1);
  expect(stored.store.events).toEqual([]);
  expect(stored.store.record).toBeNull();
  await expect(page.getByText('Nothing has been stored')).toBeVisible();
});

test('min_age is enforced: an underage participant leaves no trace', async ({ page }) => {
  await startSession(page, { merge: FAST });
  await answerConsent(page);
  await answerSubject(page, { age: '17' });
  expect(await finished(page)).toBe('ineligible');
  const stored = await page.evaluate(() => ({ lastSeq: window.sessionServices.bus.lastSeq, store: window.sessionResult.store }));
  expect(stored.lastSeq).toBe(-1);
  expect(stored.store.events).toEqual([]);
  expect(stored.store.record).toBeNull();
});

test('min_age accepts exactly the minimum age', async ({ page }) => {
  await startSession(page, { merge: FAST });
  await answerConsent(page);
  await answerSubject(page, { age: '18' });
  await page.locator('[data-name="session_type"]').waitFor();
});

test('a device that is not allowed is rejected and recorded as device_rejected', async ({ page }, testInfo) => {
  const allowed = profileOf(testInfo) === 'desktop' ? ['phone'] : ['desktop'];
  await startSession(page, { merge: { ...FAST, device: { allowed } } });
  await passEntryScreens(page);
  expect(await finished(page)).toBe('device_rejected');
  const { events, record } = await recorded(page);
  expect(events.map((e) => e.type)).toEqual(['session.start', 'session.clock_anchor', 'system.warning', 'device.profile', 'session.end']);
  expect(events.at(-1).data).toEqual({ reason: 'device_rejected' });
  expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
  expect(record).toMatchObject({ status: 'device_rejected', end_reason: 'device_rejected', last_seq: 4 });
  expect(sessionProblems(record)).toEqual([]);
  await expect(page.getByText('cannot run on this kind of device')).toBeVisible();
});

test('debug.simulate_profile overrides detection and is recorded as an override', async ({ page }) => {
  await startSession(page, { merge: { ...FAST, debug: { enabled: true, time_scale: 0.2, simulate_profile: 'tablet' }, device: { allowed: ['tablet'] } } });
  await passEntryScreens(page);
  await expect.poll(async () => (await recorded(page)).events.length).toBeGreaterThan(4);
  const { events, record } = await recorded(page);
  expect(ofType(events, 'device.profile')[0].data).toMatchObject({ profile: 'tablet', reason: 'override' });
  expect(record.device).toMatchObject({ profile: 'tablet', profile_reason: 'override' });
});

test('the same seed reproduces the trial order; another seed changes it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'order does not depend on the device; one device is enough');
  const order = async (seed) => {
    const { events, record } = await runFullSession(page, false, { ...FAST, seed });
    expect(record.experiment.seed).toBe(seed);
    return ofType(events, 'phase.onset').filter((e) => e.block === 'oddball_task').map((e) => e.data.stimulus);
  };
  const first = await order(4242);
  const again = await order(4242);
  const other = await order(4243);
  expect(again).toEqual(first);
  expect(other).not.toEqual(first);
});
