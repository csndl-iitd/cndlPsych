// Software-only timing measurements: run the timing project (300 full-screen flashes, each
// with a trigger and a photodiode flip) through the real framework in headless Chromium and
// report what the framework itself can observe about its timing.
//
//   node tools/timing/measure.js [--write docs/timing.md]
//
// What this measures: the framework's own overhead and scheduling (how long after an onset the
// trigger write is issued, how well planned durations and the stimulus rhythm are kept). What it
// cannot measure: the time until light leaves the screen, or the real serial / USB path. That
// needs the photodiode and a recorder; see docs/timing.md and tools/timing/analyze.js.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { dryRun } from '../../cli/dry-run.js';
import { initProject } from '../../cli/init.js';
import { summarize, summaryTable } from './stats.js';

const NOMINAL_CYCLE_MS = 200; // 100 ms stimulus + 100 ms gap

/** The measures, in ms, from the event log of a finished timing run. */
export function measures(events) {
  const onsets = events.filter((e) => e.type === 'phase.onset' && e.data.stimulus?.startsWith('flash_'));
  const offsets = events.filter((e) => e.type === 'phase.offset' && e.data.stimulus?.startsWith('flash_'));
  const triggers = events.filter((e) => e.type === 'trigger.sent');
  const onsetBySeq = new Map(onsets.map((e) => [e.seq, e]));
  return {
    'onset stamp - DOM update (rAF prediction)': onsets.map((e) => e.t - e.data.t_dom),
    'stimulus duration - planned (100 ms)': offsets.map((e) => e.data.actual_ms - 100),
    'onset-to-onset interval - 200 ms': onsets.slice(1).map((e, i) => e.t - onsets[i].t - NOMINAL_CYCLE_MS),
    'trigger written - onset stamp': triggers.filter((e) => onsetBySeq.has(e.data.event_seq)).map((e) => e.data.t_sent - e.data.t_event),
  };
}

const environment = (record) => [
  `- Browser: ${record.device.user_agent}`,
  `- Platform: ${record.device.platform}, screen ${record.device.screen.w} x ${record.device.screen.h} @ ${record.device.screen.dpr}x, estimated refresh ${record.device.refresh_hz_est ?? 'not estimated'} Hz`,
  `- Framework ${record.experiment.framework_version}, headless Chromium driven by Playwright, no physical display attached`,
].join('\n');

/** Frame intervals of an idle blank page in the same browser: the cadence the environment itself provides. */
export async function frameBaseline(seconds = 10) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    return await page.evaluate((duration) => new Promise((resolve) => {
      const intervals = [];
      let last = null;
      const end = performance.now() + duration * 1000;
      const frame = (t) => {
        if (last !== null) intervals.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(frame);
        else resolve(intervals);
      };
      requestAnimationFrame(frame);
    }), seconds);
  } finally {
    await browser.close();
  }
}

export function resultsMarkdown({ record, events, stuck, baseline }) {
  const rows = Object.entries(measures(events)).map(([name, values]) => [name, summarize(values)]);
  if (baseline) rows.push(['idle blank page: requestAnimationFrame interval (nominal 16.67)', summarize(baseline)]);
  const table = summaryTable(rows);
  return `${stuck ? `**The run did not finish: ${stuck}**\n\n` : ''}${environment(record)}

${table}

All values are milliseconds. The first column of numbers is how many events were measured.`;
}

const START = '<!-- results:start -->';
const END = '<!-- results:end -->';

async function main() {
  const { values } = parseArgs({ options: { write: { type: 'string' } } });
  const dir = join(mkdtempSync(join(tmpdir(), 'expfw-timing-')), 'run');
  try {
    initProject(dir, { template: 'timing' });
    console.log('running 300 flashes at real speed (about 90 s)...');
    const result = await dryRun({ dir, scale: 1, timeoutS: 300 });
    result.baseline = await frameBaseline();
    if (!result.record) throw new Error(`no session record: ${result.stuck ?? result.status}`);
    const markdown = resultsMarkdown(result);
    console.log(markdown);
    if (values.write) {
      const page = readFileSync(values.write, 'utf8');
      const [before] = page.split(START);
      const [, after] = page.split(END);
      writeFileSync(values.write, `${before}${START}\n${markdown}\n${END}${after}`);
      console.log(`\nupdated ${values.write}`);
    }
  } finally {
    rmSync(join(dir, '..'), { recursive: true, force: true });
  }
}

if (process.argv[1] === import.meta.filename) main().catch((error) => { console.error(error.message); process.exit(1); });
