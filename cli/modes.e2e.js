// Live and test mode in a real browser, on a fresh project: the first screen, the number of trials, the
// throwaway ID, the mark on the session and on its download, and the ways of not being asked.
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { clickContinue } from '../tools/e2e/session-helpers.js';
import { unzip } from '../tools/unzip.js';
import { initProject } from './init.js';
import { serveDirectory } from './serve.js';

test.setTimeout(150_000);

let dir;
let served;
test.beforeEach(({ isMobile }) => test.skip(isMobile, 'keyboard; the screens are the same on every device'));
test.afterEach(async () => {
  await served?.close();
  if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
  dir = null;
  served = null;
});

/** A fresh project; `yaml` is added to experiment.yaml. The task has 10 trials unless a mode limits them. */
async function project(yaml = '') {
  dir = join(mkdtempSync(join(tmpdir(), 'cndlpsych-modes-')), 'study');
  initProject(dir);
  appendFileSync(join(dir, 'experiment.yaml'), `\n${yaml}\n`);
  served = await serveDirectory({ dir });
  return served.url;
}

const choose = (page, name, value) => page.locator(`[data-name="${name}"] label:has(input[value="${value}"])`).click();
const MODES = `modes:
  test: { trials_per_block: 2, block_trials: { reaction: 1 } }
  live: { trials_per_block: 4 }
`;

async function throughForms(page, { id = '001' } = {}) {
  await page.locator('[data-name="decision"]').waitFor();
  await choose(page, 'decision', 'agree');
  for (const statement of ['read', 'voluntary']) await choose(page, `statement_${statement}`, 'yes');
  await clickContinue(page);
  const field = page.locator('[data-name="subject_id"] input');
  await field.waitFor();
  const shown = await field.inputValue();
  if (id) await field.fill(id);
  await choose(page, 'sex', 'female');
  await page.locator('[data-name="age"] input').fill('30');
  await clickContinue(page);
  await clickContinue(page);
  return shown;
}

async function play(page) {
  await page.getByText('Reaction time').waitFor();
  await page.evaluate(() => { window.cndlpsych.finished.then((result) => { window.__result = result; }); });
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline && !(await page.evaluate(() => window.__result !== undefined))) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(350);
  }
  return page.evaluate(() => window.__result);
}

const trialsRun = async (page) => (await page.evaluate(async () => (await window.cndlpsych.store.snapshot()).events)).filter((e) => e.type === 'trial.end').length;

test('the first screen asks which mode, says what each does, and a test is short, marked, and has a throwaway ID', async ({ page }) => {
  const url = await project(MODES);
  await page.goto(url);
  await page.getByText('Which mode do you want to run?').waitFor();
  await expect(page.getByText('at most 4 trials in each block; participant IDs are kept')).toBeVisible();
  await expect(page.getByText('(sub-test) is not kept')).toBeVisible();
  await expect(page.locator('[data-name="action"] input[value="live"]')).toBeChecked(); // live is selected unless experiment.yaml says test
  await choose(page, 'action', 'test');
  await clickContinue(page);
  const [download] = await Promise.all([page.waitForEvent('download'), (async () => {
    expect(await throughForms(page, { id: null })).toBe('sub-test'); // the ID is filled in, not claimed
    return play(page);
  })()]);

  expect(await trialsRun(page)).toBe(1); // block_trials: { reaction: 1 } wins over trials_per_block: 2
  const { record, events } = await page.evaluate(() => window.cndlpsych.store.snapshot());
  expect(record.mode).toBe('test');
  expect(record.subject_id).toBe('sub-test');
  expect(events.find((e) => e.type === 'session.start').data.mode).toBe('test');
  await expect(page.getByText('This was a test session')).toBeVisible();
  expect(download.suggestedFilename()).toBe('test_sub-test_ses-01.zip');
  expect(JSON.parse(unzip(new Uint8Array(readFileSync(await download.path())))['session.json']).mode).toBe('test');
});

test('live runs the trials that live allows, with no mark and no ID filled in', async ({ page }) => {
  const url = await project(MODES);
  await page.goto(url);
  await page.getByText('Which mode do you want to run?').waitFor();
  await clickContinue(page); // live is already selected
  expect(await throughForms(page)).toBe('');
  await play(page);
  expect(await trialsRun(page)).toBe(4);
  const { record, events } = await page.evaluate(() => window.cndlpsych.store.snapshot());
  expect(record).not.toHaveProperty('mode');
  expect(record.subject_id).toBe('sub-001');
  expect(events.find((e) => e.type === 'session.start').data.mode).toBe('live');
  await expect(page.getByText('This was a test session')).toHaveCount(0);
});

test('?mode=test in the address goes straight to the consent, as a test', async ({ page }) => {
  const url = await project(MODES);
  await page.goto(`${url}?mode=test`);
  await page.locator('[data-name="decision"]').waitFor(); // no mode screen
  expect(await throughForms(page, { id: null })).toBe('sub-test');
});

test('modes.enabled: false asks nothing and uses modes.default', async ({ page }) => {
  await page.goto(await project('modes: { enabled: false, default: test }'));
  await page.locator('[data-name="decision"]').waitFor();
  expect(await throughForms(page, { id: null })).toBe('sub-test');
});

test('the default mode on the first screen can be test', async ({ page }) => {
  await page.goto(await project('modes: { default: test }'));
  await page.getByText('Which mode do you want to run?').waitFor();
  await expect(page.locator('[data-name="action"] input[value="test"]')).toBeChecked();
});
