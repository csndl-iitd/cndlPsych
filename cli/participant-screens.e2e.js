// What a participant sees and can do on the built-in screens, on a fresh project in a real
// browser: the dark compact look, forms taller than the screen scroll, the form fields, and a
// device with several input sources (touch screen, mouse, keyboard) accepts all of them.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { answerConsent, clickContinue } from '../tools/e2e/session-helpers.js';
import { initProject } from './init.js';
import { serveDirectory } from './serve.js';

test.setTimeout(120_000);

let dir;
let served;
test.afterEach(async () => {
  await served?.close();
  if (dir) rmSync(join(dir, '..'), { recursive: true, force: true });
  dir = null;
  served = null;
});

/** A fresh project served from a temporary folder; `forms` replaces forms.yaml. */
async function project({ forms } = {}) {
  dir = join(mkdtempSync(join(tmpdir(), 'expfw-screens-')), 'study');
  initProject(dir);
  if (forms) writeFileSync(join(dir, 'forms.yaml'), forms);
  served = await serveDirectory({ dir });
  return served.url;
}

const channel = (value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgbOf = (css) => css.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);

/** Consent answered, the subject form showing. */
async function toSubjectForm(page, url) {
  await page.goto(url);
  await answerConsent(page);
  await page.locator('[data-name="sex"]').waitFor();
}

const choose = (page, name, value) => page.locator(`[data-name="${name}"] label:has(input[value="${value}"])`).click();

async function answerSubjectForm(page, { age = '30' } = {}) {
  await page.locator('[data-name="subject_id"] input').fill('001');
  await choose(page, 'sex', 'female');
  await page.locator('[data-name="age"] input').fill(age);
  await clickContinue(page);
}

// ---- look -------------------------------------------------------------------------------------
test('the screens are dark, readable and compact: no white panel, good contrast, one font, the whole subject form fits', async ({ page, viewport }) => {
  const url = await project();
  await page.goto(url);
  await page.locator('[data-name="decision"]').waitFor();
  const colours = await page.evaluate(() => {
    const style = (selector) => getComputedStyle(document.querySelector(selector));
    return { stage: style('.expfw-stage').backgroundColor, root: style('.sd-root-modern').backgroundColor, text: style('.sd-html').color, title: style('.sd-question__title').color, font: style('.expfw-stage').fontFamily };
  });
  expect(luminance(rgbOf(colours.stage))).toBeLessThan(0.05);
  expect(colours.root === 'rgba(0, 0, 0, 0)' || luminance(rgbOf(colours.root)) < 0.05).toBe(true);
  expect(contrast(rgbOf(colours.text), rgbOf(colours.stage))).toBeGreaterThan(7);
  expect(contrast(rgbOf(colours.title), rgbOf(colours.stage))).toBeGreaterThan(7);
  expect(colours.font).toMatch(/system-ui|Segoe UI|Roboto|Arial/);

  await toSubjectForm(page, url);
  const lightBoxes = await page.evaluate(() => [...document.querySelectorAll('.expfw-display *')].filter((el) => {
    const c = getComputedStyle(el).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
    return c.length >= 3 && (c[3] ?? 1) > 0.5 && c[0] > 200 && c[1] > 200 && c[2] > 200;
  }).length);
  expect(lightBoxes).toBe(0);
  const box = await page.locator('.sd-root-modern').boundingBox();
  expect(box.height).toBeLessThan(Math.min(viewport.height - 40, 520)); // ID, sex, age, one extra question and the button
  const overflow = await page.evaluate(() => ({ vertical: document.querySelector('.expfw-display').scrollHeight - document.querySelector('.expfw-display').clientHeight, horizontal: document.documentElement.scrollWidth - innerWidth }));
  expect(overflow).toEqual({ vertical: 0, horizontal: 0 });
});

test('the instructions use the same font as the forms', async ({ page }) => {
  const url = await project();
  await toSubjectForm(page, url);
  const formFont = await page.evaluate(() => getComputedStyle(document.querySelector('.sd-question__title')).fontFamily);
  await answerSubjectForm(page);
  await clickContinue(page); // the session form
  await page.getByText('Reaction time').waitFor();
  const instructionFont = await page.evaluate(() => getComputedStyle(document.querySelector('.expfw-display h2')).fontFamily);
  expect(instructionFont).toBe(formFont);
  expect(instructionFont).not.toMatch(/Times/);
});

// ---- fields --------------------------------------------------------------------------------------
test('sex offers male and female (in one row), and age takes any number, with no upper limit and none required beyond zero', async ({ page }) => {
  await toSubjectForm(page, await project());
  const sex = await page.locator('[data-name="sex"] input[type=radio]').evaluateAll((inputs) => inputs.map((input) => input.value));
  expect(sex).toEqual(['male', 'female']);
  const tops = await page.locator('[data-name="sex"] label').evaluateAll((labels) => labels.map((label) => Math.round(label.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  await expect(page.locator('[data-name="age"] input')).toHaveAttribute('type', 'number');
  await answerSubjectForm(page, { age: '104' });
  await expect(page.locator('[data-name="session_id"]')).toBeVisible(); // accepted: on to the session form
});

test('age is not restricted unless the experiment asks: min_age in experiment.yaml turns the check on', async ({ page }) => {
  const url = await project();
  await toSubjectForm(page, url);
  await answerSubjectForm(page, { age: '7' });
  await expect(page.locator('[data-name="session_id"]')).toBeVisible();
  await page.close();
});

// ---- scrolling -----------------------------------------------------------------------------------
const LONG_FORM = `subject:\n  questions:\n${Array.from({ length: 20 }, (_, i) => `    - { name: extra_${i + 1}, prompt: "Extra question ${i + 1}", type: text }`).join('\n')}\n`;

test('a form taller than the screen scrolls (wheel or touch), starts at its top, and its last question and button can be reached', async ({ page, isMobile }) => {
  const url = await project({ forms: LONG_FORM });
  if (!isMobile) await page.setViewportSize({ width: 1100, height: 420 });
  await toSubjectForm(page, url);
  const metrics = () => page.evaluate(() => { const d = document.querySelector('.expfw-display'); return { top: d.scrollTop, max: d.scrollHeight - d.clientHeight }; });
  const before = await metrics();
  expect(before.max).toBeGreaterThan(200);
  expect(before.top).toBe(0);
  await expect(page.locator('[data-name="subject_id"] input')).toBeInViewport(); // the top of the form is reachable
  const heading = await page.locator('.sd-title').first().boundingBox();
  expect(heading.y).toBeGreaterThanOrEqual(0);

  const centre = await page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2 }));
  if (isMobile) {
    // a real swipe up: finger down, moves up in steps, lifts
    const client = await page.context().newCDPSession(page);
    const swipe = Math.min(before.max, 400);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centre.x, y: centre.y + swipe / 2 }] });
    for (let step = 1; step <= 10; step += 1) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: centre.x, y: centre.y + swipe / 2 - (swipe * step) / 10 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, before.max + 500);
  }
  await expect.poll(async () => (await metrics()).top).toBeGreaterThan(50);
  if (!isMobile) {
    await expect(page.locator('[data-name="extra_20"] input')).toBeInViewport();
    await expect(page.locator('input[type=button][value=Continue]')).toBeInViewport();
  }
});

// ---- several input sources -----------------------------------------------------------------------
const touchAndMouse = (page) => page.addInitScript(() => {
  Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query) => (query.includes('any-pointer: coarse') ? { ...real(query), matches: true } : real(query));
});
const mouseOnly = (page) => page.addInitScript(() => { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 }); });

async function toInstructions(page, url) {
  await toSubjectForm(page, url);
  await answerSubjectForm(page);
  await clickContinue(page); // the session form
  await page.getByText('Reaction time').waitFor();
}

const tap = (page) => page.evaluate(() => {
  const { stage } = window.expfw.services;
  const { x, y, w, h } = stage.rect;
  ['pointerdown', 'pointerup'].forEach((type) => stage.root.dispatchEvent(new PointerEvent(type, { clientX: x + w / 2, clientY: y + h / 2, pointerId: 7, pointerType: 'touch', button: 0, isPrimary: true, bubbles: true })));
});
const eventTypes = (page) => page.evaluate(async () => (await window.expfw.store.snapshot()).events.map((e) => e.type));

test('a computer with a touch screen shows both ways to respond, and a tap works as well as SPACE', async ({ page, isMobile }) => {
  test.skip(isMobile, 'this is about a computer that also has touch');
  await touchAndMouse(page);
  await toInstructions(page, await project());
  await expect(page.getByText('Press SPACE or tap the screen')).toBeVisible();
  const { record } = await page.evaluate(() => window.expfw.store.snapshot());
  expect(record.device.profile).toBe('desktop');
  expect(record.device.input_profiles).toEqual(['desktop', 'phone', 'tablet']);
  await tap(page);
  await expect.poll(() => eventTypes(page)).toContain('input.tap');
  await expect.poll(async () => (await eventTypes(page)).includes('phase.onset')).toBe(true);
  // the page moved on from the instructions: the fixation of the first trial is next
  const events = await page.evaluate(async () => (await window.expfw.store.snapshot()).events);
  expect(events.filter((e) => e.type === 'phase.onset').map((e) => e.data.stimulus)).toEqual(expect.arrayContaining(['instructions', 'fixation']));
});

test('SPACE still answers on that same computer', async ({ page, isMobile }) => {
  test.skip(isMobile, 'this is about a computer that also has touch');
  await touchAndMouse(page);
  await toInstructions(page, await project());
  await page.keyboard.press('Space');
  await expect.poll(async () => (await eventTypes(page)).includes('semantic.go')).toBe(true);
});

test('a computer with only a mouse and keyboard shows just the keyboard hint, and a phone just the tap hint', async ({ page, isMobile }) => {
  if (!isMobile) await mouseOnly(page);
  await toInstructions(page, await project());
  await expect(page.getByText(isMobile ? 'Tap the screen as soon as you see it.' : 'Press SPACE as soon as you see it.')).toBeVisible();
  const { record } = await page.evaluate(() => window.expfw.store.snapshot());
  expect(record.device.input_profiles ?? [record.device.profile]).not.toContain(isMobile ? 'desktop' : 'phone');
});
