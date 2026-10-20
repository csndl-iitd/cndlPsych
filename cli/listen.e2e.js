// `cndlpsych listen` with a real browser: a project with a websocket sink pointing at the listener sends its
// triggers there, the built-in ones (key press 1, key release 7, photodiode 9 / 10, the intent 11) among them.
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { clickContinue } from '../tools/e2e/session-helpers.js';
import { initProject } from './init.js';
import { startListener } from './listen.js';
import { serveDirectory } from './serve.js';

test.setTimeout(120_000);

const choose = (page, name, value) => page.locator(`[data-name="${name}"] label:has(input[value="${value}"])`).click();

test('a session sends its triggers to the listener, with the event that caused each', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard');
  const received = [];
  const listener = await startListener({ port: 0, ack: true, onTrigger: (record) => received.push(record) });
  const dir = join(mkdtempSync(join(tmpdir(), 'cndlpsych-listen-')), 'study');
  initProject(dir);
  appendFileSync(join(dir, 'experiment.yaml'), `
triggers:
  sinks:
    - { id: lab, type: websocket, url: "ws://127.0.0.1:${listener.port}", format: ndjson, fields: [seq, value, event, rule, t_event, t_sent], ack: true }
overlay:
  photodiode: { enabled: true, corner: bl, size: 40px }
`);
  const served = await serveDirectory({ dir });
  try {
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
    await page.getByText('Reaction time').waitFor();
    await page.evaluate(() => { window.cndlpsych.finished.then((result) => { window.__result = result; }); });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && !(await page.evaluate(() => window.__result !== undefined))) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(400);
    }
    expect(await page.evaluate(() => window.__result?.status)).toBe('complete');
    await expect.poll(() => received.length).toBeGreaterThan(20);
    const byValue = new Map();
    for (const record of received) byValue.set(record.value, record);
    expect(byValue.get(1)).toMatchObject({ event: 'input.key.down', rule: 'universal:key_down' });
    expect(byValue.get(7)).toMatchObject({ event: 'input.key.up' });
    expect(byValue.get(9)).toMatchObject({ event: 'overlay.photodiode' });
    expect(byValue.get(10)).toMatchObject({ event: 'overlay.photodiode' });
    expect(byValue.get(11)).toMatchObject({ event: 'bridge.key_injected', rule: 'semantic:go' });
    expect([...listener.counts.keys()]).toEqual(expect.arrayContaining([1, 7, 9, 10, 11]));
  } finally {
    await served.close();
    await listener.close();
    rmSync(join(dir, '..'), { recursive: true, force: true });
  }
});
