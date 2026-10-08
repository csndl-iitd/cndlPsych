// Play a whole experiment with a synthetic participant and print what happened.
//
//   node cli/dry-run.js <project-dir> [--profile desktop|phone|tablet] [--scale 0.1]
//                       [--events] [--json out.json] [--timeout 300]
//
// It opens your project in headless Chromium (Playwright; `npx playwright install chromium`
// once), answers the consent and forms, responds to what is on screen through the keys and taps
// your input settings define, and prints blocks, trials, triggers and problems. Sinks are
// replaced by recording fakes so triggers can be seen without hardware. Firebase and eye
// tracking are switched off, the session is kept in memory, and durations are shortened by
// `--scale` (default 0.1). This checks the logic of your experiment, not its timing.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dump } from 'js-yaml';
import { parseYaml } from '../framework/authoring/spec.js';
import { serveDirectory } from './serve.js';

const PROFILES = ['desktop', 'phone', 'tablet'];

// ---- the page side -------------------------------------------------------------------------
/** Replaces the device APIs a sink needs with recorders that accept everything. Runs before the page's own scripts. */
function installFakeDevices() {
  const log = [];
  window.__dryRunDevices = log;
  const bytes = (data) => (typeof data === 'string' ? data : [...data].map((b) => b.toString(16).padStart(2, '0')).join(' '));
  const port = {
    open: async () => {},
    readable: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) },
    writable: { getWriter: () => ({ write: async (data) => { log.push({ via: 'serial', data: bytes(data) }); }, releaseLock() {} }) },
    close: async () => {},
  };
  Object.defineProperty(navigator, 'serial', { configurable: true, value: { requestPort: async () => port } });
  const device = {
    open: async () => {}, selectConfiguration: async () => {}, claimInterface: async () => {}, close: async () => {},
    transferOut: async (_endpoint, data) => { log.push({ via: 'usb', data: bytes(data) }); return { status: 'ok' }; },
  };
  Object.defineProperty(navigator, 'usb', { configurable: true, value: { requestDevice: async () => device } });
  window.WebSocket = class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      setTimeout(() => { this.readyState = 1; this.onopen?.({}); }, 0);
    }

    send(data) {
      log.push({ via: 'websocket', data });
      let message = null;
      try { message = JSON.parse(data); } catch { /* raw text */ }
      const reply = message && 'ping' in message ? { pong: message.ping, t: performance.now() } : { ack: true };
      setTimeout(() => this.onmessage?.({ data: `${JSON.stringify(reply)}\n` }), 1);
    }

    close() { this.readyState = 3; this.onclose?.({}); }
  };
}

/** Answers what is on screen the way the input settings allow: a key or a tap per phase. Runs in the page once the session exists. */
function installResponder({ profile, delayMs }) {
  const { services, plan } = window.expfw;
  const { bus, stage } = services;
  window.__dryRunResponses = 0;
  const press = (key) => ['keydown', 'keyup'].forEach((type) => document.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })));
  const tap = () => {
    const rect = stage.rect;
    ['pointerdown', 'pointerup'].forEach((type) => stage.root.dispatchEvent(new PointerEvent(type, {
      clientX: rect.x + rect.w / 2, clientY: rect.y + rect.h / 2, pointerId: 9, pointerType: profile === 'desktop' ? 'mouse' : 'touch', button: 0, isPrimary: true, bubbles: true,
    })));
  };
  function respond() {
    const scope = plan.blocks.find((block) => block.id === bus.context.block)?.input?.[profile];
    if (!scope) return;
    const bindings = Object.values(scope.intents).flatMap((intent) => intent.bindings);
    const ruleKeys = scope.rules.filter((rule) => rule.match?.on === 'input.key.down' && rule.match.where?.key).map((rule) => ({ key: rule.match.where.key }));
    const choice = [...bindings, ...ruleKeys].find((binding) => binding.key !== undefined || binding.tap);
    if (!choice) return;
    window.__dryRunResponses += 1;
    if (choice.key !== undefined) press([choice.key].flat()[0]);
    else tap();
  }
  bus.on('phase.onset', () => setTimeout(respond, delayMs));
}

// ---- forms -------------------------------------------------------------------------------------
const PREFERRED = ['agree', 'yes', 'resume', 'connect', 'retry', 'go', 'start', 'continue'];

/** Fill every question on the current survey screen, then press Continue. */
async function fillForm(page) {
  const names = await page.locator('[data-name]').evaluateAll((els) => els.map((el) => el.dataset.name));
  for (const name of new Set(names)) {
    const question = page.locator(`[data-name="${name}"]`).first();
    const radios = question.locator('label:has(input[type=radio])');
    const boxes = question.locator('label:has(input[type=checkbox])');
    if (await radios.count()) {
      const values = await question.locator('input[type=radio]').evaluateAll((els) => els.map((el) => el.value));
      if (await question.locator('input[type=radio]:checked').count()) continue;
      const wanted = values.findIndex((value) => PREFERRED.includes(value.toLowerCase()));
      await radios.nth(wanted >= 0 ? wanted : 0).click();
    } else if (await boxes.count()) {
      if (!(await question.locator('input[type=checkbox]:checked').count())) await boxes.first().click();
    } else if (await question.locator('.sd-dropdown').count()) {
      await question.locator('.sd-dropdown').click();
      await page.locator('.sv-list__item').first().click();
    } else if (await question.locator('input[type=text], input[type=number], textarea').count()) {
      const field = question.locator('input[type=text], input[type=number], textarea').first();
      if (!(await field.inputValue())) await field.fill(name === 'age' ? '30' : name === 'subject_id' ? '001' : '1');
    }
  }
  await page.locator('input[type=button][value=Continue], input[type=button][value=Complete]').first().click();
}

// ---- report -----------------------------------------------------------------------------------
const brief = (data) => JSON.stringify(data).slice(0, 90);
const line = (event) => `${String(event.seq).padStart(4)} ${event.t.toFixed(1).padStart(9)}  ${event.type.padEnd(22)} ${event.block ?? ''}${event.trial ? `#${event.trial}` : ''} ${brief(event.data)}`;

/** The report, as text, for a finished (or stuck) run. */
export function summarise({ events, record, status, devices, responses, stuck }) {
  const out = [];
  const blocks = events.filter((e) => e.type === 'block.start').map((e) => e.data.block_id);
  out.push(`status: ${status}${stuck ? ` (STUCK: ${stuck})` : ''}`, `events: ${events.length}, responses sent by the dry run: ${responses}`);
  out.push('', 'blocks:');
  for (const id of blocks) {
    const trials = events.filter((e) => e.type === 'trial.end' && e.block === id);
    const outcomes = Object.entries(Object.groupBy(trials, (e) => e.data.outcome)).map(([k, v]) => `${v.length} ${k}`).join(', ');
    const end = events.find((e) => e.type === 'block.end' && e.block === id);
    out.push(`  ${id.padEnd(24)} ${trials.length} trial(s)${outcomes ? ` (${outcomes})` : ''}  ended: ${end?.data.reason ?? 'no'}`);
  }
  const sent = events.filter((e) => e.type === 'trigger.sent');
  const dropped = events.filter((e) => e.type === 'trigger.dropped');
  out.push('', `triggers: ${sent.length} sent, ${dropped.length} dropped`);
  const byRule = Object.groupBy(sent, (e) => `${e.data.sink} <- ${e.data.rule}`);
  for (const [key, list] of Object.entries(byRule)) out.push(`  ${key}: ${list.length}x, values ${[...new Set(list.map((e) => e.data.value))].join(', ')}`);
  if (devices.length) out.push('  first writes to the fake devices:', ...devices.slice(0, 5).map((d) => `    ${d.via}: ${d.data.trim().slice(0, 80)}`));
  const problems = events.filter((e) => e.type === 'system.warning' || e.type === 'system.error');
  out.push('', `warnings and errors: ${problems.length}`, ...problems.map((e) => `  ${e.type === 'system.error' ? 'ERROR' : 'warning'} ${e.data.code}: ${e.data.message}`));
  if (record) out.push('', `record: ${record.subject_id}_${record.session_id}, ${record.status}, last_seq ${record.last_seq}`);
  return out.join('\n');
}

// ---- run -----------------------------------------------------------------------------------------
/**
 * @param {{dir: string, profile?: string, scale?: number, timeoutS?: number, log?: (text: string) => void}} options
 * @returns {Promise<{status: string, events: object[], record: object|null, devices: object[], responses: number, stuck?: string}>}
 */
export async function dryRun({ dir, profile = 'desktop', scale = 0.1, timeoutS = 300 }) {
  const { chromium, devices } = await import('@playwright/test');
  const rewrite = (path, body) => {
    if (path !== '/experiment.yaml') return body;
    const doc = parseYaml(body.toString('utf8'));
    doc.debug = { ...doc.debug, enabled: true, time_scale: scale, simulate_profile: profile };
    doc.storage = { ...doc.storage, local: { ...doc.storage?.local, enabled: false, export_on_finish: [] } };
    if (doc.storage.firebase) doc.storage.firebase.enabled = false;
    if (doc.eyetracking) doc.eyetracking.enabled = false;
    return dump(doc);
  };
  const server = await serveDirectory({ dir, rewrite });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(profile === 'desktop' ? { viewport: { width: 1280, height: 720 } } : devices[profile === 'phone' ? 'Pixel 7' : 'Galaxy Tab S4']);
    const page = await context.newPage();
    const problems = [];
    page.on('pageerror', (error) => problems.push(error.message));
    await page.addInitScript(installFakeDevices);
    await page.goto(server.url);
    await page.waitForFunction(() => window.expfw?.services !== undefined || window.expfw?.finished, null, { timeout: 30_000 }).catch(() => {});
    await page.waitForFunction(() => window.expfw?.plan !== undefined, null, { timeout: 30_000 });
    await page.evaluate(installResponder, { profile, delayMs: 40 });
    await page.evaluate(() => { window.expfw.finished.then((result) => { window.__dryRunResult = result; }); });

    const deadline = Date.now() + timeoutS * 1000;
    while (Date.now() < deadline && !(await page.evaluate(() => window.__dryRunResult !== undefined))) {
      if (await page.locator('input[type=button][value=Continue], input[type=button][value=Complete]').first().isVisible().catch(() => false)) {
        await fillForm(page).catch(() => {});
      }
      await page.waitForTimeout(100);
    }
    const finished = await page.evaluate(() => window.__dryRunResult !== undefined);
    const snapshot = await page.evaluate(async () => ({
      ...(await window.expfw.store.snapshot()),
      status: window.__dryRunResult?.status ?? 'running',
      devices: window.__dryRunDevices,
      responses: window.__dryRunResponses,
      lastEvent: window.expfw.services.bus.lastSeq,
      context: window.expfw.services.bus.context,
      text: document.body.innerText.slice(0, 200),
    }));
    const stuck = finished ? undefined : `no progress after ${timeoutS} s at block ${snapshot.context.block ?? '-'}, trial ${snapshot.context.trial ?? '-'}; screen says: ${snapshot.text.replace(/\s+/g, ' ')}`;
    return { status: snapshot.status, events: snapshot.events, record: snapshot.record ?? null, devices: snapshot.devices, responses: snapshot.responses, stuck, problems };
  } finally {
    await browser.close();
    await server.close();
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    profile: { type: 'string', default: 'desktop' }, scale: { type: 'string', default: '0.1' }, events: { type: 'boolean', default: false }, json: { type: 'string' }, timeout: { type: 'string', default: '300' },
  } });
  if (!PROFILES.includes(values.profile)) throw new Error(`--profile must be one of ${PROFILES.join(', ')}`);
  const dir = resolve(positionals[0] ?? '.');
  readFileSync(join(dir, 'experiment.yaml')); // fail early with a clear error when this is not a project
  const result = await dryRun({ dir, profile: values.profile, scale: Number(values.scale), timeoutS: Number(values.timeout) });
  if (values.events) console.log(result.events.map(line).join('\n'), '\n');
  console.log(summarise(result));
  if (result.problems?.length) console.log('\npage errors:', ...result.problems.map((p) => `\n  ${p}`));
  if (values.json) writeFileSync(values.json, `${JSON.stringify({ record: result.record, events: result.events }, null, 2)}\n`);
  process.exit(result.status === 'complete' ? 0 : 1);
}

if (process.argv[1] === import.meta.filename) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
