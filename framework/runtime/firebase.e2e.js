// Firebase in a whole session, in a real browser. Firestore is replaced by an in-memory fake
// that lives in the test process (tools/e2e/fake-firestore.js), so these tests cover the
// lifecycle (sign-in, subject numbers, mirroring, resume), not Firestore itself: the rules and
// the SDK are tested against the emulator (spec/firebase, framework/storage/firebase.emulator.test.js).
import { expect, test } from '@playwright/test';
import { killProfile, launchProfile, newProfileDir, removeProfileDir } from '../../tools/e2e/hard-kill.js';
import { createFakeFirestore } from '../../tools/e2e/fake-firestore.js';
import {
  clickContinue, answerConsent, answerPostTask, answerSession, answerSubject, captureLog, continueDeviceScreen, finished, installAutopilot,
  passEntryScreens, recorded, startSession,
} from '../../tools/e2e/session-helpers.js';
import { integrityReport } from '../storage/integrity.js';

test.setTimeout(180_000);

const BASE = 'http://localhost:4173';
const choose = (page, name, value) => page.locator(`[data-name="${name}"] label:has(input[value="${value}"])`).click();
const KEY = 'sub-001_ses-01';
const merge = (access, extra = {}) => ({
  debug: { enabled: true, time_scale: 0.2 },
  triggers: { sinks: [] },
  storage: { local: { flush_ms: 200 }, firebase: { access, subject_id: { override: false }, chunk: { max_events: 60, flush_ms: 500 }, ...extra } },
});

async function begin(context, page, fake, { access, extra, local = false } = {}) {
  await context.exposeBinding('fakeFirestore', fake.handle);
  await startSession(page, { local, merge: merge(access, extra), firebase: { uid: 'anon-1', access } });
  await captureLog(page);
}

test('public: the number is assigned late, the form has no ID field, and the session is mirrored completely', async ({ context, page, isMobile }) => {
  test.skip(isMobile, 'a full session; the device kind is irrelevant to storage');
  const fake = createFakeFirestore({ access: 'public' });
  await begin(context, page, fake, { access: 'public' });
  await installAutopilot(page, { touch: false });
  await answerConsent(page);
  await page.locator('[data-name="sex"]').waitFor();
  expect(fake.state.signIns).toBe(1);
  await expect(page.locator('[data-name="subject_id"]')).toHaveCount(0);
  expect(fake.state.claims.size).toBe(0); // nothing is claimed until the participant is eligible and about to start
  await answerSubject(page, { id: null });
  await answerSession(page);
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(page);
  expect(await finished(page)).toBe('complete');

  const { record, events } = await recorded(page);
  expect(record.subject_id).toBe('sub-001');
  expect(record.sinks.storage).toEqual(['local', 'firebase']);
  const stored = fake.stored(KEY);
  expect(stored.claims).toEqual([{ n: 1, label: 'sub-001', status: 'complete' }]);
  expect(stored.session).toMatchObject({ status: 'complete', uid: 'anon-1', experiment_id: 'oddball-flashes-and-visual-search', n_chunks: stored.chunks.length, last_seq: events.at(-1).seq });
  expect(stored.chunks.length).toBeGreaterThan(1);
  const report = await integrityReport(stored.session, stored.chunks);
  expect(report).toMatchObject({ partial: false, issues: [] });
  expect(report.events).toEqual(events);
  expect(events.filter((e) => e.type === 'storage.status' && e.data.sink === 'firebase').map((e) => e.data.state)).toEqual(expect.arrayContaining(['opening', 'ready']));
});

test('public: a participant who declines does not sign in and claims no number', async ({ context, page }) => {
  const fake = createFakeFirestore({ access: 'public' });
  await begin(context, page, fake, { access: 'public' });
  await answerConsent(page, { agree: false });
  await page.getByText('Nothing has been stored').waitFor();
  expect(fake.state.signIns).toBe(0);
  expect(fake.state.claims.size).toBe(0);
});

test('public: if sign-in fails nothing starts and nothing is claimed', async ({ context, page }) => {
  const fake = createFakeFirestore({ access: 'public', failSignIn: 'auth is down' });
  await begin(context, page, fake, { access: 'public' });
  await answerConsent(page);
  await page.getByText('Could not connect to the data server: auth is down').waitFor();
  expect((await page.evaluate(() => window.sessionPromise)).status).toBe('remote_failed');
  expect(fake.state.claims.size).toBe(0);
  expect(await page.evaluate(() => window.sessionStore.record)).toBeNull();
});

test('controlled: the experimenter signs in first, and the ID is prefilled and locked when the experiment locks it', async ({ context, page }) => {
  const fake = createFakeFirestore({ uid: 'admin-1', access: 'controlled' });
  fake.state.claims.set(1, { n: 1, label: 'sub-001', status: 'complete' });
  fake.state.claims.set(2, { n: 2, label: 'sub-002', status: 'complete' });
  await context.exposeBinding('fakeFirestore', fake.handle);
  await startSession(page, { merge: merge('controlled'), firebase: { uid: 'admin-1', access: 'controlled' } });
  await page.getByText('Sign in with your lab account').waitFor();
  expect(fake.state.signIns).toBe(0);
  await continueDeviceScreen(page);
  await answerConsent(page);
  const field = page.locator('[data-name="subject_id"] input');
  await expect(field).toHaveValue('sub-003');
  await expect(field).toHaveAttribute('readonly', '');
});

test('controlled: the experimenter may override the ID; a different free one needs a confirmed warning', async ({ context, page }) => {
  const fake = createFakeFirestore({ uid: 'admin-1', access: 'controlled' });
  fake.state.claims.set(5, { n: 5, label: 'sub-005', status: 'complete' });
  await context.exposeBinding('fakeFirestore', fake.handle);
  await startSession(page, { merge: merge('controlled', { subject_id: { override: true } }), firebase: { uid: 'admin-1', access: 'controlled' } });
  await captureLog(page);
  await continueDeviceScreen(page);
  await answerConsent(page);
  const field = page.locator('[data-name="subject_id"] input');
  await expect(field).toHaveValue('sub-001');
  await expect(field).not.toHaveAttribute('readonly', '');
  await expect(page.getByText('Suggested: sub-001')).toBeVisible();

  // a free number that is not the suggestion: a warning, and going back changes nothing
  await answerSubject(page, { id: '12' });
  await expect(page.getByText('Use a different participant ID?')).toBeVisible();
  await choose(page, 'action', 'back');
  await clickContinue(page);
  await expect(page.locator('[data-name="age"] input')).toHaveValue('24'); // back at the form, answers kept
  await field.fill('12');
  await clickContinue(page);
  await page.getByText('Use a different participant ID?').waitFor();
  await expect(page.getByText('The next free participant ID is sub-001, but you entered 12.')).toBeVisible();
  await choose(page, 'action', 'back');
  await clickContinue(page);
  await expect(field).toHaveValue('12');

  // confirm it: the session goes on with that number, and the log says it was overridden
  await clickContinue(page);
  await choose(page, 'action', 'use');
  await clickContinue(page);
  await answerSession(page);
  await expect.poll(() => fake.state.claims.has(12)).toBe(true);
  expect([...fake.state.claims.keys()].sort((a, b) => a - b)).toEqual([5, 12]);
  const log = await page.evaluate(() => window.__log);
  const warning = log.find((e) => e.type === 'system.warning' && e.data.code === 'subject_id_overridden');
  expect(warning.data.detail).toEqual({ suggested: 'sub-001', used: '12' });
});

test('controlled: a number used before is reused: the details come from the earlier session, the next session number is suggested, and a session they have cannot be repeated', async ({ context, page }) => {
  const fake = createFakeFirestore({ uid: 'admin-1', access: 'controlled' });
  fake.state.claims.set(5, { n: 5, label: 'sub-005', status: 'complete' });
  fake.state.sessions.set('someone-else/sub-005_ses-01', {
    subject_id: 'sub-005', session_id: 'ses-01', started_at: '2026-10-01T10:00:00Z', status: 'complete', subject: { sex: 'male', age: 41, handedness: 'left' },
  });
  await context.exposeBinding('fakeFirestore', fake.handle);
  await startSession(page, { merge: merge('controlled', { subject_id: { override: true } }), firebase: { uid: 'admin-1', access: 'controlled' } });
  await captureLog(page);
  await continueDeviceScreen(page);
  await answerConsent(page);
  const field = page.locator('[data-name="subject_id"] input');
  await answerSubject(page, { id: '5' }); // what the experimenter typed: the ID and some answers

  // the participant is known: told so, and their sessions are listed
  await page.getByText('5 has been used before').waitFor();
  await expect(page.getByText('already has one session in this experiment (ses-01)')).toBeVisible();
  await choose(page, 'action', 'use');
  await clickContinue(page);

  // the form again, with their details in it (editable) and a note on where they came from
  await expect(field).toHaveValue('5');
  await expect(page.locator('[data-name="age"] input')).toHaveValue('41');
  await expect(page.locator('[data-name="sex"] input[value="male"]')).toBeChecked();
  await expect(page.locator('[data-name="handedness"] input[value="left"]')).toBeChecked();
  await expect(page.getByText('filled in from session ses-01 (2026-10-01)')).toBeVisible();
  await page.locator('[data-name="age"] input').fill('42'); // the experimenter changes what is different
  await clickContinue(page);

  // the session: ses-02 is suggested, ses-01 is refused
  const session = page.locator('[data-name="session_id"] input');
  await expect(session).toHaveValue('02');
  await session.fill('01');
  await page.locator('[data-name="session_type"] .sd-dropdown').click();
  await page.locator('.sv-list__item', { hasText: 'Experimental' }).first().click();
  await clickContinue(page);
  await page.getByText('ses-01 already exists').waitFor();
  await choose(page, 'action', 'back');
  await clickContinue(page);
  await expect(session).toHaveValue('02');
  await page.locator('[data-name="session_type"] .sd-dropdown').click();
  await page.locator('.sv-list__item', { hasText: 'Experimental' }).first().click();
  await clickContinue(page);

  await expect.poll(() => fake.state.sessions.has('admin-1/sub-005_ses-02')).toBe(true);
  expect(fake.state.sessions.get('admin-1/sub-005_ses-02').subject).toMatchObject({ sex: 'male', age: 42, handedness: 'left' });
  expect(fake.state.claims.get(5).status).toBe('complete'); // the first use keeps its state; no new claim
  expect([...fake.state.claims.keys()]).toEqual([5]);
  const warning = (await page.evaluate(() => window.__log)).find((e) => e.type === 'system.warning' && e.data.code === 'subject_id_reused');
  expect(warning.data.detail).toEqual({ id: '5', earlier_sessions: ['ses-01'] });
});

test('controlled: the suggested number is used without a warning', async ({ context, page }) => {
  const fake = createFakeFirestore({ uid: 'admin-1', access: 'controlled' });
  fake.state.claims.set(1, { n: 1, label: 'sub-001', status: 'complete' });
  await context.exposeBinding('fakeFirestore', fake.handle);
  await startSession(page, { merge: merge('controlled', { subject_id: { override: true } }), firebase: { uid: 'admin-1', access: 'controlled' } });
  await captureLog(page);
  await continueDeviceScreen(page);
  await answerConsent(page);
  await expect(page.locator('[data-name="subject_id"] input')).toHaveValue('sub-002');
  await answerSubject(page, { id: 'sub-002' });
  await answerSession(page);
  await expect.poll(() => fake.state.claims.has(2)).toBe(true);
  expect((await page.evaluate(() => window.__log)).some((e) => e.type === 'system.warning' && e.data.code === 'subject_id_overridden')).toBe(false);
});

test('a killed session resumes into the same Firestore session and ends complete, with no chunk missing or doubled', async ({ isMobile }) => {
  test.skip(isMobile, 'a full session with a browser kill');
  const fake = createFakeFirestore({ access: 'public' });
  const dir = newProfileDir();
  try {
    const first = await launchProfile(dir, BASE);
    await first.exposeBinding('fakeFirestore', fake.handle);
    const page = await first.newPage();
    await startSession(page, { local: true, merge: merge('public'), firebase: { uid: 'anon-1', access: 'public' } });
    await captureLog(page);
    await installAutopilot(page, { touch: false });
    await passEntryScreens(page, { subject: { id: null } });
    await expect.poll(() => page.evaluate(() => window.__log.filter((e) => e.type === 'trial.end' && e.block === 'oddball_task').length), { timeout: 90_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(1500);
    await killProfile(dir);
    const before = fake.stored(KEY);
    expect(before.session.status).toBe('in_progress');
    expect(before.chunks.length).toBeGreaterThan(0);
    expect((await integrityReport(before.session, before.chunks)).partial).toBe(true);

    const second = await launchProfile(dir, BASE);
    await second.exposeBinding('fakeFirestore', fake.handle);
    const again = await second.newPage();
    await startSession(again, { local: true, merge: merge('public'), firebase: { uid: 'anon-1', access: 'public' } });
    await installAutopilot(again, { touch: false });
    await expect(again.getByText('It can be')).toBeVisible();
    await continueDeviceScreen(again, 'resume');
    await again.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
    await answerPostTask(again);
    expect(await finished(again)).toBe('complete');

    const { events } = await again.evaluate(() => window.sessionStore.snapshot());
    const stored = fake.stored(KEY);
    expect(stored.claims).toEqual([{ n: 1, label: 'sub-001', status: 'complete' }]);
    expect(stored.session.status).toBe('complete');
    const report = await integrityReport(stored.session, stored.chunks);
    expect(report).toMatchObject({ partial: false, issues: [] });
    expect(report.events).toEqual(events);
    expect(events.filter((e) => e.type === 'session.resume')).toHaveLength(1);
    await second.close();
  } finally {
    removeProfileDir(dir);
  }
});
