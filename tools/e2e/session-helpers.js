// Helpers for whole-session browser tests: start the session, answer the built-in screens,
// and script the participant (an in-page autopilot that injects keys or taps).

export async function startSession(page, options = {}) {
  page.appErrors = [];
  page.on('pageerror', (error) => page.appErrors.push(error.message));
  await page.goto(`/tools/e2e/session.html${options.query ?? ''}`);
  await page.waitForFunction(() => window.sessionReady === true);
  await page.evaluate((o) => { window.runSession(o); }, options);
  await page.waitForFunction(() => window.sessionServices !== undefined);
}

/** SurveyJS hides the native inputs; the visible label takes the click. */
const choose = (page, name, value) => page.locator(`[data-name="${name}"] label:has(input[value="${value}"])`).click();

export const clickContinue = (page) => page.locator('input[type=button][value=Continue]').click();

export async function answerConsent(page, { agree = true } = {}) {
  await choose(page, 'decision', agree ? 'agree' : 'decline');
  if (agree) {
    for (const id of ['read', 'voluntary']) await choose(page, `statement_${id}`, 'yes');
  }
  await clickContinue(page);
}

export async function answerSubject(page, { id = '007', sex = 'female', age = '24', handedness = 'right' } = {}) {
  await page.locator('[data-name="subject_id"] input').fill(id);
  await choose(page, 'sex', sex);
  await page.locator('[data-name="age"] input').fill(age);
  await choose(page, 'handedness', handedness);
  await clickContinue(page);
}

export async function answerSession(page, { sessionType = 'Experimental' } = {}) {
  await page.locator('[data-name="session_type"] .sd-dropdown').click();
  await page.locator('.sv-list__item', { hasText: sessionType }).first().click();
  await clickContinue(page);
}

export async function answerPostTask(page, { difficulty = '4', strategy = 'No' } = {}) {
  await choose(page, 'difficulty', difficulty);
  await choose(page, 'strategy', strategy);
  await clickContinue(page);
}

/** The trigger device screen: choose the default action (connect, or retry) and continue. */
export async function continueDeviceScreen(page, action) {
  await page.locator('[data-name="action"]').waitFor();
  if (action) await choose(page, 'action', action);
  await clickContinue(page);
}

/**
 * Answer every screen up to the blocks. `connect: true` also clicks through the trigger device
 * screen (needed when the project has a serial or USB sink).
 */
export async function passEntryScreens(page, answers = {}) {
  await answerConsent(page);
  await answerSubject(page, answers.subject);
  await answerSession(page, answers.session);
  if (answers.connect) await continueDeviceScreen(page);
}

/**
 * Script the participant inside the page. Instruction pages are advanced; the oddball
 * letter is answered on its second occurrence; the visual search is completed (SPACE on
 * desktop, taps on both targets on touch devices).
 * @param {{touch: boolean, skipSecondOddball?: boolean}} options
 */
export function installAutopilot(page, options) {
  return page.evaluate(({ touch, skipSecondOddball }) => {
    const { bus, stage } = window.sessionServices;
    const space = () => ['keydown', 'keyup'].forEach((type) => document.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true, cancelable: true })));
    const tapAt = (cx, cy) => ['pointerdown', 'pointerup'].forEach((type) => stage.root.dispatchEvent(new PointerEvent(type, {
      clientX: cx, clientY: cy, pointerId: 5, pointerType: 'touch', button: 0, isPrimary: true, bubbles: true,
    })));
    const respond = () => {
      if (!touch) space();
      else tapAt(stage.rect.x + stage.rect.w / 2, stage.rect.y + stage.rect.h / 2);
    };
    let letters = 0;
    bus.on('trial.start', () => { letters = 0; });
    bus.on('phase.onset', (event) => {
      const { phase, stimulus } = event.data;
      if (phase === 'page') setTimeout(respond, 30);
      if (stimulus === 'oddball_Ǝ') {
        letters += 1;
        if (letters === 2 && !skipSecondOddball) setTimeout(respond, 4);
      }
      if (stimulus === 'search_array') {
        setTimeout(() => {
          if (!touch) { space(); return; }
          for (const el of document.querySelectorAll('[data-role=target]')) {
            const box = el.getBoundingClientRect();
            tapAt(box.x + box.width / 2, box.y + box.height / 2);
          }
        }, 30);
      }
    });
  }, options);
}

/** Wait for the session to finish and return its status. */
export async function finished(page, timeout = 90_000) {
  await page.waitForFunction(() => window.sessionResult !== undefined, undefined, { timeout });
  return page.evaluate(() => window.sessionResult.status);
}

/** The recorded events and session record so far (also available while the session runs). */
export function recorded(page) {
  return page.evaluate(() => ({ events: window.sessionStore.events, record: window.sessionStore.record, finished: window.sessionStore.finished }));
}

/** Record every event in the page (events are only delivered once recording has started). */
export const captureLog = (page) => page.evaluate(() => {
  window.__log = [];
  window.sessionServices.bus.on('*', (event) => window.__log.push(event));
});
