// A response to one particular stimulus of a sequence (rt_from): timed from that stimulus even when a later
// one is showing, accepted in the gap after a stimulus, and a miss when there is none. Real browser, desktop.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { clickContinue } from '../tools/e2e/session-helpers.js';
import { initProject } from './init.js';
import { serveDirectory } from './serve.js';

test.setTimeout(120_000);

const STIMULI = `styles: {}
stimuli:
  - { name: intro, type: text, text: "Press SPACE at the second T", size: 40px, duration: null }
  - { name: "letter_{value}", type: text, text: "{value}", size: 72px, each: [A, B, T], duration: 200, post: 300 }
`;
const TIMELINE = `blocks:
  - id: intro
    module: instructions
    config: { pages: [intro] }
  - id: oddball
    module: response_task
    config:
      order: sequential
      trials:
        - name: oddball
          sequence: [letter_A, letter_T, letter_B, letter_T, letter_A, letter_B]
          response: go
          response_window: any
          correct: { intent: go, where: { stimulus: letter_T, occurrence: 2 } }
          rt_from: { stimulus: letter_T, occurrence: 2 }
          post: 600
          repetitions: 5
`;

let dir;
let served;
test.beforeEach(({ isMobile }) => test.skip(isMobile, 'desktop browser, keyboard'));
test.afterEach(async () => {
  await served?.close();
  if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
  dir = null;
  served = null;
});

const choose = (page, name, value) => page.locator(`[data-name="${name}"] label:has(input[value="${value}"])`).click();

test('the response time is from the second T, in the gap or while a later letter shows; a response before it has none; no response is a miss', async ({ page }) => {
  dir = join(mkdtempSync(join(tmpdir(), 'expfw-rtfrom-')), 'study');
  initProject(dir);
  writeFileSync(join(dir, 'stimuli.yaml'), STIMULI);
  writeFileSync(join(dir, 'timeline.yaml'), TIMELINE);
  served = await serveDirectory({ dir });

  await page.goto(served.url);
  await page.locator('[data-name="decision"]').waitFor();
  await choose(page, 'decision', 'agree');
  for (const id of ['read', 'voluntary']) await choose(page, `statement_${id}`, 'yes');
  await clickContinue(page);
  await page.locator('[data-name="subject_id"] input').fill('001');
  await choose(page, 'sex', 'female');
  await page.locator('[data-name="age"] input').fill('30');
  await clickContinue(page);
  await clickContinue(page);
  await page.getByText('Press SPACE at the second T').waitFor();

  // What each trial does (ms after the second T appears; 'early' = at the first T; null = nothing):
  // trial 1 in the gap after it, 2 while the next letter shows, 3 early, 4 nothing, 5 at the very end of the sequence's last letter.
  await page.evaluate(() => {
    const plan = [350, 650, 'early', null, 1200];
    const { bus } = window.expfw.services;
    const press = () => ['keydown', 'keyup'].forEach((type) => document.dispatchEvent(new KeyboardEvent(type, { key: ' ', bubbles: true, cancelable: true })));
    const seen = {};
    bus.on('phase.onset', (e) => {
      if (e.data.stimulus !== 'letter_T') return;
      seen[e.trial] = (seen[e.trial] ?? 0) + 1;
      const what = plan[e.trial - 1];
      if (what === 'early' && seen[e.trial] === 1) setTimeout(press, 60);
      if (typeof what === 'number' && seen[e.trial] === 2) setTimeout(press, what);
    });
    window.expfw.finished.then((result) => { window.__result = result; });
  });
  await page.keyboard.press('Space'); // the instructions
  await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 90_000 });

  const events = await page.evaluate(async () => (await window.expfw.store.snapshot()).events);
  const secondT = (trial) => events.filter((e) => e.type === 'phase.onset' && e.trial === trial && e.data.stimulus === 'letter_T')[1];
  const evaluated = (trial) => events.filter((e) => e.type === 'response.evaluated' && e.trial === trial);
  const ended = (trial) => events.find((e) => e.type === 'trial.end' && e.trial === trial);

  const [r1] = evaluated(1);
  expect(r1.data).toMatchObject({ correct: true, stimulus: 'letter_T', occurrence: 2 });
  expect(r1.data.rt_ms).toBeGreaterThan(300);
  expect(r1.data.rt_ms).toBeLessThan(420); // from the T (it is still the gap after it)
  expect(r1.data.rt_ms).toBeCloseTo(r1.t - secondT(1).t, 5);

  const [r2] = evaluated(2);
  expect(r2.data).toMatchObject({ correct: true, stimulus: 'letter_T', occurrence: 2 });
  expect(r2.data.rt_ms).toBeGreaterThan(600); // from the T, not from the letter B that is showing by then
  expect(r2.data.rt_ms).toBeLessThan(720);

  const [r3] = evaluated(3);
  expect(r3.data).toMatchObject({ correct: false, rt_ms: null });
  expect(ended(3).data.outcome).toBe('incorrect');

  const [r4] = evaluated(4);
  expect(r4.data).toMatchObject({ intent: null, correct: false, rt_ms: null, stimulus: 'letter_T', occurrence: 2 });

  const [r5] = evaluated(5); // in the gap after the last letter
  expect(r5.data).toMatchObject({ correct: true, stimulus: 'letter_T', occurrence: 2 });
  expect(r5.data.rt_ms).toBeGreaterThan(1150);
  expect(r5.data.rt_ms).toBeLessThan(1300);

  // each response ended its trial: far fewer letters than the six of a full trial were shown after the response
  for (const trial of [1, 2]) {
    const shown = events.filter((e) => e.type === 'phase.onset' && e.trial === trial && e.data.stimulus?.startsWith('letter_')).length;
    expect(shown, `trial ${trial} stopped at the response`).toBeLessThan(6);
  }
  expect(events.filter((e) => e.type === 'system.error')).toEqual([]);
});
