// Text, forms and buttons must never sit under the AprilTags, on a phone (where four 64 px tags in the corners
// leave a narrow column inside the stage) as on a computer, while stimuli keep the stage's own coordinates.
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { quietMode } from '../tools/e2e/project.js';
import { clickContinue } from '../tools/e2e/session-helpers.js';
import { initProject } from './init.js';
import { serveDirectory } from './serve.js';

test.setTimeout(150_000);

let dir;
let served;
test.afterEach(async () => {
  await served?.close();
  if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
  dir = null;
  served = null;
});

async function project() {
  dir = join(mkdtempSync(join(tmpdir(), 'cndlpsych-overlay-')), 'study');
  initProject(dir);
  quietMode(dir);
  appendFileSync(join(dir, 'experiment.yaml'), `
overlay:
  apriltags: { enabled: true, family: tag36h11, ids: [0, 1, 2, 3], size: 64px, margin: 4px, quiet_zone: 1 }
`);
  served = await serveDirectory({ dir });
  return served.url;
}

const choose = (page, name, value) => page.locator(`[data-name="${name}"] label:has(input[value="${value}"])`).click();

/** Everything a participant reads or presses on this screen is on the screen and clear of every tag. */
async function expectClearOfTags(page, what) {
  const report = await page.evaluate(() => {
    const view = { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
    const tags = [...document.querySelectorAll('.cndlpsych-apriltag')].map((el) => el.getBoundingClientRect());
    const things = [...document.querySelectorAll('.cndlpsych-display input, .cndlpsych-display label, .cndlpsych-display h1, .cndlpsych-display h2, .cndlpsych-display p, .cndlpsych-display .sd-title, .cndlpsych-display .sd-question__title')];
    const problems = [];
    for (const el of things) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      const name = `${el.tagName.toLowerCase()} "${(el.value ?? el.textContent ?? '').trim().slice(0, 30)}"`;
      if (r.left < -0.5 || r.right > view.w + 0.5) problems.push(`${name} is cut off at the side (${Math.round(r.left)} to ${Math.round(r.right)} of ${view.w})`);
      if (tags.some((t) => r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top)) problems.push(`${name} is under a tag`);
    }
    return { problems, tags: tags.length, things: things.length };
  });
  expect(report.tags, `${what}: tags are drawn`).toBe(4);
  expect(report.things, `${what}: there is something to check`).toBeGreaterThan(2);
  expect(report.problems, what).toEqual([]);
}

test('on every device the consent, the forms and the instructions fit between the tags, and the buttons can be pressed', async ({ page }) => {
  await page.goto(await project());
  await page.locator('[data-name="decision"]').waitFor();
  await expectClearOfTags(page, 'consent');
  await choose(page, 'decision', 'agree');
  for (const id of ['read', 'voluntary']) await choose(page, `statement_${id}`, 'yes');
  await expectClearOfTags(page, 'consent with the statements');
  await clickContinue(page); // a click on the button: it is not under a tag

  await page.locator('[data-name="subject_id"] input').fill('001');
  await choose(page, 'sex', 'female');
  await page.locator('[data-name="age"] input').fill('30');
  await expectClearOfTags(page, 'subject form');
  await clickContinue(page);
  await expectClearOfTags(page, 'session form');
  await clickContinue(page);
  await page.getByText('Reaction time').waitFor();
  await expectClearOfTags(page, 'instructions');
});

test('the tags are smaller on a phone (60% of the size) than on a tablet or a computer, and the experiment gets the room', async ({ page, isMobile }) => {
  await page.goto(await project());
  await page.locator('[data-name="decision"]').waitFor();
  const { tag, stage, view } = await page.evaluate(() => ({
    tag: document.querySelector('.cndlpsych-apriltag').getBoundingClientRect().width,
    stage: window.cndlpsych.services.stage.rect,
    view: { w: innerWidth, h: innerHeight },
  }));
  const phone = Math.min(view.w, view.h) < 600;
  expect(tag).toBeCloseTo(phone ? 38 + 2 * (38 / 8) : 64 + 16, 0); // the tag and its quiet zone
  const border = Math.min(stage.x, stage.y);
  expect(border).toBeCloseTo(phone ? 38 + 2 * (38 / 8) + 4 : 84, 0);
  expect(isMobile || !phone).toBe(true);
});

test('while stimuli run the display is exactly the stage, so positions are stage positions; text screens reach past it', async ({ page }) => {
  await page.goto(await project());
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

  const boxes = () => page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const { stage } = window.cndlpsych.services;
    return { display: rect(document.querySelector('.cndlpsych-display')), stage: rect(stage.element), view: { w: innerWidth, h: innerHeight } };
  });
  const text = await boxes();
  const tall = text.view.h > text.view.w;
  expect(tall ? text.display.w : text.display.h).toBe(tall ? text.view.w : text.view.h); // reaches the screen's edge on the free axis
  expect(text.display).not.toEqual(text.stage);

  // the instructions end with a tap or SPACE; then the first trial is a block of stimuli
  await page.evaluate(() => {
    const { stage } = window.cndlpsych.services;
    const { x, y, w, h } = stage.rect;
    ['pointerdown', 'pointerup'].forEach((type) => stage.root.dispatchEvent(new PointerEvent(type, { clientX: x + w / 2, clientY: y + h / 2, pointerId: 5, pointerType: 'touch', button: 0, isPrimary: true, bubbles: true })));
    ['keydown', 'keyup'].forEach((type) => document.dispatchEvent(new KeyboardEvent(type, { key: ' ', bubbles: true, cancelable: true })));
  });
  await page.waitForFunction(() => window.cndlpsych.services.bus.context.block === 'reaction' && window.cndlpsych.services.bus.context.phase !== null, null, { timeout: 30_000 });
  const stimuli = await boxes();
  expect(stimuli.display).toEqual(stimuli.stage);
});
