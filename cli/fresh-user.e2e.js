// The M10 acceptance for users: a fresh folder made by `cndlpsych init` runs a working experiment,
// and changing it needs only the YAML files (and index.html, which the template already has).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { dryRun } from './dry-run.js';
import { initProject } from './init.js';
import { serveDirectory } from './serve.js';
import { validateProject } from './validate.js';

test.setTimeout(240_000);

let dir;
test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'the dry run emulates the devices itself; run once');
  dir = join(mkdtempSync(join(tmpdir(), 'cndlpsych-fresh-')), 'study'); initProject(dir);
});
test.afterEach(() => { if (dir) rmSync(join(dir, '..'), { recursive: true, force: true }); });

const edit = (file, change) => writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')));
const ofType = (events, type) => events.filter((e) => e.type === type);

test('a fresh template runs end to end on every device kind', async () => {
  expect((await validateProject(dir)).ok).toBe(true);
  for (const profile of ['desktop', 'phone', 'tablet']) {
    const result = await dryRun({ dir, profile, timeoutS: 120 });
    expect(result.status, `${profile}: ${result.stuck}`).toBe('complete');
    expect(ofType(result.events, 'trial.end')).toHaveLength(10);
    expect(ofType(result.events, 'trial.end').every((e) => e.data.outcome === 'completed')).toBe(true);
    expect(result.problems).toEqual([]);
  }
});

test('editing only the YAML changes the experiment: fewer trials, a new stimulus, a new question', async () => {
  edit('timeline.yaml', (text) => text.replace('repetitions: 10', 'repetitions: 3'));
  edit('stimuli.yaml', (text) => text.replace('shape: circle', 'shape: square'));
  edit('forms.yaml', (text) => `${text}    - { name: coffee, prompt: "Cups of coffee today:", type: text }\n`);
  expect((await validateProject(dir)).ok).toBe(true);
  const result = await dryRun({ dir, timeoutS: 120 });
  expect(result.status).toBe('complete');
  expect(ofType(result.events, 'trial.end')).toHaveLength(3);
  expect(result.record.subject).toHaveProperty('coffee');
});

test('a mistake in the YAML is shown on the page with its file and path, not as a blank screen', async ({ page }) => {
  edit('timeline.yaml', (text) => text.replace('module: response_task', 'module: response_taks'));
  const served = await serveDirectory({ dir });
  try {
    await page.goto(served.url);
    await expect(page.getByText('This experiment has errors')).toBeVisible();
    await expect(page.getByText('timeline.yaml')).toBeVisible();
  } finally {
    await served.close();
  }
});

test('the page loads everything from the experiment folder alone, with no failed request', async ({ page }) => {
  const failures = [];
  const outside = [];
  const served = await serveDirectory({ dir });
  page.on('response', (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  page.on('request', (request) => { if (!request.url().startsWith(served.url) && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) outside.push(request.url()); });
  try {
    await page.goto(served.url);
    await expect(page.locator('[data-name="decision"]')).toBeVisible(); // the consent screen
    expect(failures).toEqual([]);
    expect(outside).toEqual([]);
  } finally {
    await served.close();
  }
});
