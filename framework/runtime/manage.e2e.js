import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { unzip } from '../../tools/unzip.js';
import { clickContinue, continueDeviceScreen, startSession } from '../../tools/e2e/session-helpers.js';

test.setTimeout(60_000);

const FAST = { debug: { enabled: true, time_scale: 0.2 }, triggers: { sinks: [] }, storage: { local: { flush_ms: 100, export_on_finish: ['jsonl'] } } };

/** Put sessions into the browser's local database: [{n, status}] with n making ids and times unique. */
async function seed(page, sessions) {
  await page.goto('/tools/e2e/session.html');
  await page.waitForFunction(() => window.sessionReady === true);
  await page.evaluate(async (list) => {
    for (const { n, status } of list) {
      const store = window.expfwStorage.createLocalStore({ flushMs: 20 });
      const record = { subject_id: `sub-00${n}`, session_id: 'ses-01', started_at: `2026-10-0${n}T10:00:00.000Z`, status: 'in_progress' };
      store.begin(record);
      for (let seq = 0; seq < 3; seq += 1) {
        store.append({ v: 1, seq, t: seq, source: 'system', type: 'page.focus', data: { focused: true }, block: null, trial: null, phase: null, caused_by: null });
      }
      await store.flush();
      if (status === 'complete') await store.finish({ ...record, status: 'complete' });
      if (status === 'aborted') await store.abandon(store.__key ?? (await store.findUnfinished()).find((s) => s.record.subject_id === record.subject_id).key);
    }
  }, sessions);
}

const stored = (page) => page.evaluate(async () => (await window.expfwStorage.createLocalStore().listSessions()).map((s) => [s.record.subject_id, s.status]));
const openManager = async (page) => {
  await startSession(page, { query: '?manage=1', merge: FAST, local: true });
  await page.locator('[data-name="selected"]').waitFor();
};
const item = (page, subject) => page.locator('[data-name="selected"] label', { hasText: subject });
const selectAll = (page) => page.locator('[data-name="selected"] label', { hasText: 'Select all' }).click();
const chooseAction = (page, value) => page.locator(`[data-name="action"] label:has(input[value="${value}"])`).click();

test('lists every stored session with its status, newest first', async ({ page }) => {
  await seed(page, [{ n: 1, status: 'complete' }, { n: 2, status: 'in_progress' }, { n: 3, status: 'aborted' }]);
  await openManager(page);
  await expect(page.getByText('3 sessions stored in this browser')).toBeVisible();
  const labels = await page.locator('[data-name="selected"] label').allInnerTexts();
  const rows = labels.filter((text) => text.includes('sub-00')).map((text) => text.replace(/\s+/g, ' ').trim());
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain('sub-003');
  expect(rows[0]).toContain('aborted');
  expect(rows[0]).toContain('can be resumed');
  expect(rows[1]).toContain('interrupted');
  expect(rows[2]).toContain('sub-001');
  expect(rows[2]).toContain('finished');
  expect(rows[2]).not.toContain('can be resumed');
  expect(rows[2]).toContain('3 events');
});

test('select all, then delete: asks for confirmation and removes every session', async ({ page }) => {
  await seed(page, [{ n: 1, status: 'complete' }, { n: 2, status: 'complete' }, { n: 3, status: 'in_progress' }]);
  await openManager(page);
  await selectAll(page);
  for (const subject of ['sub-001', 'sub-002', 'sub-003']) {
    await expect(item(page, subject).locator('input')).toBeChecked();
  }
  await chooseAction(page, 'delete');
  await clickContinue(page);

  await expect(page.getByText('Delete 3 sessions?')).toBeVisible();
  await expect(page.getByText('This cannot be undone')).toBeVisible();
  expect(await stored(page)).toHaveLength(3); // nothing is deleted until confirmed
  await continueDeviceScreen(page, 'delete');

  await expect(page.getByText('No sessions are stored in this browser')).toBeVisible();
  await expect(page.getByText('Deleted 3 sessions')).toBeVisible();
  expect(await stored(page)).toEqual([]);
});

test('delete only the sessions that are ticked (session level choice)', async ({ page }) => {
  await seed(page, [{ n: 1, status: 'complete' }, { n: 2, status: 'complete' }, { n: 3, status: 'complete' }]);
  await openManager(page);
  await item(page, 'sub-001').click();
  await item(page, 'sub-003').click();
  await chooseAction(page, 'delete');
  await clickContinue(page);
  await expect(page.getByText('Delete 2 sessions?')).toBeVisible();
  await expect(page.getByText('sub-001 ses-01')).toBeVisible();
  await continueDeviceScreen(page, 'delete');

  await expect(page.getByText('1 session stored in this browser')).toBeVisible();
  expect(await stored(page)).toEqual([['sub-002', 'finished']]);
});

test('"Keep them" on the confirmation changes nothing; an empty selection is refused', async ({ page }) => {
  await seed(page, [{ n: 1, status: 'complete' }, { n: 2, status: 'complete' }]);
  await openManager(page);
  await chooseAction(page, 'delete');
  await clickContinue(page);
  await expect(page.getByText('Nothing was selected')).toBeVisible();

  await selectAll(page);
  await chooseAction(page, 'delete');
  await clickContinue(page);
  await continueDeviceScreen(page, 'cancel');
  await expect(page.getByText('2 sessions stored in this browser')).toBeVisible();
  expect(await stored(page)).toHaveLength(2);
});

test('download saves the selected sessions as zips and keeps them', async ({ page }) => {
  await seed(page, [{ n: 1, status: 'complete' }, { n: 2, status: 'complete' }]);
  await openManager(page);
  await item(page, 'sub-002').click();
  await chooseAction(page, 'download');
  const [download] = await Promise.all([page.waitForEvent('download'), clickContinue(page)]);
  expect(download.suggestedFilename()).toBe('sub-002_ses-01.zip');
  const files = unzip(new Uint8Array(readFileSync(await download.path())));
  expect(Object.keys(files)).toEqual(['session.json', 'events.jsonl']);
  expect(files['events.jsonl'].trim().split('\n')).toHaveLength(3);
  await expect(page.getByText('Downloaded 1 session')).toBeVisible();
  expect(await stored(page)).toHaveLength(2);
});

test('resume needs exactly one session, and refuses one that ended normally', async ({ page }) => {
  await seed(page, [{ n: 1, status: 'complete' }, { n: 2, status: 'complete' }]);
  await openManager(page);
  await selectAll(page);
  await chooseAction(page, 'resume');
  await clickContinue(page);
  await expect(page.getByText('Select exactly one session to resume')).toBeVisible();

  await item(page, 'sub-001').click();
  await chooseAction(page, 'resume');
  await clickContinue(page);
  await expect(page.getByText('This session cannot be resumed')).toBeVisible();
  await expect(page.getByText('already ended normally')).toBeVisible();
});

test('closing the screen leaves the data alone and does not start the experiment', async ({ page }) => {
  await seed(page, [{ n: 1, status: 'complete' }]);
  await openManager(page);
  await chooseAction(page, 'back');
  await clickContinue(page);
  await expect(page.getByText('The local data screen is closed')).toBeVisible();
  expect(await stored(page)).toHaveLength(1);
  expect(await page.evaluate(() => window.sessionServices.bus.lastSeq)).toBe(-1);
});

test('with no stored sessions the screen says so; with local storage off it explains', async ({ page }) => {
  await startSession(page, { query: '?manage=1', merge: FAST, local: true });
  await expect(page.getByText('No sessions are stored in this browser')).toBeVisible();

  await startSession(page, { query: '?manage=1', merge: { ...FAST, storage: { local: { enabled: false, flush_ms: 100 } } } });
  await expect(page.getByText('Local storage is switched off')).toBeVisible();
});

test('the manager records nothing and creates nothing: no events, and sessions are only changed on request', async ({ page }) => {
  await seed(page, [{ n: 1, status: 'complete' }]);
  await openManager(page);
  expect(await page.evaluate(() => window.sessionServices.bus.recording)).toBe(false);
  expect(await stored(page)).toEqual([['sub-001', 'finished']]);
});
