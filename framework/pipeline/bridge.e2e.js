import { expect, test } from '@playwright/test';
import { compile } from '../authoring/compiler.js';
import { exampleProject } from '../../tools/project-fixture.js';
import { eventsOf, openApp, pointerDriver, stageRect, tap } from '../../tools/e2e/helpers.js';

test.afterEach(({ page }) => {
  expect(page.appErrors ?? []).toEqual([]);
});

// Chromium emulation projects are named after the profile they should be detected as.
async function visualSearchScope(profile) {
  const { plan } = compile(await exampleProject());
  return plan.blocks.find((block) => block.id === 'visual_search').input[profile];
}

async function startTrial(page, accepted) {
  await page.evaluate((intents) => { window.trialPromise = window.app.runTrial(intents); }, accepted);
  await page.waitForSelector('#jspsych-html-keyboard-response-stimulus');
}

const finishTrial = (page) => page.evaluate(() => window.trialPromise);

async function placeTargets(page) {
  await page.evaluate(() => {
    window.app.addTarget({ id: 1, role: 'target', left: 60, top: 160 });
    window.app.addTarget({ id: 2, role: 'target', left: 260, top: 160 });
    window.app.addTarget({ id: 9, role: 'distractor', left: 160, top: 300 });
  });
}

test('visual search: the same intent ends an unmodified jsPsych keyboard trial on every device', async ({ page, isMobile }, testInfo) => {
  const profile = testInfo.project.name;
  const scope = await visualSearchScope(profile);
  await openApp(page, { scope, profile, withJsPsych: true });
  await placeTargets(page);
  const nextKey = await page.evaluate(() => window.app.keys.next);
  await startTrial(page, ['next']);

  if (!isMobile) {
    await page.evaluate(() => { window.seenByPage = []; document.addEventListener('keydown', (e) => window.seenByPage.push(e.key)); });
    await page.keyboard.press(' ');
  } else {
    const driver = await pointerDriver(page, true);
    const rect = await stageRect(page);
    const at = (left, top) => [rect.x + left + 40, rect.y + top + 40];
    await tap(driver, page, ...at(60, 160));
    await tap(driver, page, ...at(160, 300));
    await tap(driver, page, ...at(60, 160));
    expect(await eventsOf(page, 'semantic.next')).toEqual([]);
    await page.waitForTimeout(50);
    expect(await page.locator('#jspsych-html-keyboard-response-stimulus').count()).toBe(1);
    await tap(driver, page, ...at(260, 160));
  }

  const data = await finishTrial(page);
  expect(data.response).toBe(nextKey);

  const [semantic] = await eventsOf(page, 'semantic.next');
  expect(semantic.data).toMatchObject(profile === 'desktop'
    ? { rule: 'space_done', completion: 'self_report' }
    : { rule: 'two_taps', completion: 'verified_taps' });

  const [injected] = await eventsOf(page, 'bridge.key_injected');
  expect(injected.data).toEqual({ key: nextKey, intent: 'next', origin_t: semantic.t });
  expect(injected.caused_by).toBe(semantic.seq);
  const cause = (await eventsOf(page)).find((e) => e.seq === semantic.caused_by);
  expect(cause.t).toBe(semantic.t);

  const bridgeTypes = (await eventsOf(page, 'jspsych.')).map((e) => e.type);
  expect(bridgeTypes).toEqual(['jspsych.trial.start', 'jspsych.trial.load', 'jspsych.trial.end']);
  expect((await eventsOf(page, 'jspsych.trial.start'))[0].data.plugin).toBe('html-keyboard-response');
});

test('desktop: the space key bound to an intent never reaches the page; jsPsych gets the injected key', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'keyboard path');
  const profile = testInfo.project.name;
  await openApp(page, { scope: await visualSearchScope(profile), profile, withJsPsych: true });
  await startTrial(page, ['next']);
  await page.evaluate(() => { window.seenByPage = []; document.addEventListener('keydown', (e) => window.seenByPage.push(e.key)); });
  await page.keyboard.press(' ');
  const data = await finishTrial(page);
  expect(data.response).not.toBe(' ');
  // The page never sees the real space; it only sees the synthetic key bubbling inside the display.
  expect(await page.evaluate(() => window.seenByPage)).toEqual([await page.evaluate(() => window.app.keys.next)]);
  const [down] = await eventsOf(page, 'input.key.down');
  expect(down.data).toMatchObject({ key: ' ', consumed: true, trusted: true });
});

test('a response to an intent the trial does not accept is logged but does not end the trial', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'keyboard path');
  const profile = testInfo.project.name;
  await openApp(page, { scope: await visualSearchScope(profile), profile, withJsPsych: true });
  await startTrial(page, ['next']);
  await page.keyboard.press(' ');
  const data = await finishTrial(page);
  expect(data.response).toBe(await page.evaluate(() => window.app.keys.next));
  const intents = (await eventsOf(page, 'semantic.')).map((e) => e.data.intent).sort();
  expect(intents).toEqual(['go', 'next']);
  expect((await eventsOf(page, 'bridge.key_injected')).map((e) => e.data.intent)).toEqual(['next']);
});

test('"any" is answered by a real key natively and by a tap through an injected key', async ({ page, isMobile }, testInfo) => {
  // No binding competes for the input here: a tap bound to another intent is consumed and does not count as "any".
  await openApp(page, { scope: { intents: {}, rules: [], gestures: ['tap'] }, profile: testInfo.project.name, withJsPsych: true });
  await startTrial(page, ['any']);
  if (isMobile) {
    const driver = await pointerDriver(page, true);
    await tap(driver, page, 200, 200);
  } else {
    await page.keyboard.press('a');
  }
  const data = await finishTrial(page);
  const injected = await eventsOf(page, 'bridge.key_injected');
  if (isMobile) {
    expect(data.response).toBe(await page.evaluate(() => window.app.keys.any));
    expect(injected.map((e) => e.data.intent)).toEqual(['any']);
  } else {
    expect(data.response).toBe('a');
    expect(injected).toEqual([]);
  }
});

test('the event log has gap-free seq across input, semantic, bridge and system events', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'keyboard path');
  const profile = testInfo.project.name;
  await openApp(page, { scope: await visualSearchScope(profile), profile, withJsPsych: true });
  await startTrial(page, ['next']);
  await page.keyboard.press(' ');
  await finishTrial(page);
  const events = await eventsOf(page);
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
  expect(new Set(events.map((e) => e.source))).toEqual(new Set(['system', 'input', 'semantic', 'bridge']));
});
