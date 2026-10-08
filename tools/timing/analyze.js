// Hardware latency analysis: a recording of the photodiode patch and the trigger line on the
// same clock (an oscilloscope, a DAQ, or the EEG amplifier's analog channels) in, the delay
// between them out.
//
//   node tools/timing/analyze.js <recording.csv> [--photodiode photodiode] [--trigger trigger] [--window-ms 100]
//
// The CSV has a header row with a time column in seconds (`time_s`) and one numeric column per
// channel. Each stimulus onset produces one trigger pulse and one photodiode edge (the patch
// toggles). Positive delay = the screen changed after the trigger line went high.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { summarize, summaryTable } from './stats.js';

/** Parse the recording into {time: number[], channels: Record<string, number[]>}. */
export function parseRecording(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const names = header.split(',').map((name) => name.trim());
  if (names[0] !== 'time_s') throw new Error('the first column must be time_s');
  const columns = names.map(() => []);
  for (const line of lines) line.split(',').forEach((value, i) => columns[i].push(Number(value)));
  return { time: columns[0], channels: Object.fromEntries(names.slice(1).map((name, i) => [name, columns[i + 1]])) };
}

/**
 * Times (s) where a signal crosses the midpoint of its range, interpolated between samples.
 * @param {{direction?: 'rising'|'falling'|'both'}} [options]
 */
export function detectEdges(time, signal, { direction = 'both' } = {}) {
  const low = Math.min(...signal);
  const high = Math.max(...signal);
  if (high - low === 0) return [];
  const mid = (low + high) / 2;
  const edges = [];
  for (let i = 1; i < signal.length; i += 1) {
    const rising = signal[i - 1] < mid && signal[i] >= mid;
    const falling = signal[i - 1] >= mid && signal[i] < mid;
    if (!((rising && direction !== 'falling') || (falling && direction !== 'rising'))) continue;
    const fraction = (mid - signal[i - 1]) / (signal[i] - signal[i - 1]);
    edges.push(time[i - 1] + fraction * (time[i] - time[i - 1]));
  }
  return edges;
}

/**
 * Pair each trigger edge with the next photodiode edge, within `windowS` either side.
 * @returns {{delaysMs: number[], unmatchedTriggers: number, unmatchedDiode: number}}
 */
export function pairEdges(triggerEdges, diodeEdges, windowS = 0.1) {
  const delaysMs = [];
  let unmatchedTriggers = 0;
  let cursor = 0;
  for (const trigger of triggerEdges) {
    while (cursor < diodeEdges.length && diodeEdges[cursor] < trigger - windowS) cursor += 1;
    const candidate = diodeEdges[cursor];
    if (candidate !== undefined && Math.abs(candidate - trigger) <= windowS) {
      delaysMs.push((candidate - trigger) * 1000);
      cursor += 1;
    } else {
      unmatchedTriggers += 1;
    }
  }
  return { delaysMs, unmatchedTriggers, unmatchedDiode: diodeEdges.length - delaysMs.length };
}

/** @returns {{pairs: ReturnType<typeof pairEdges>, summary: ReturnType<typeof summarize>, sampleIntervalMs: number}} */
export function analyzeRecording(recording, { photodiode = 'photodiode', trigger = 'trigger', windowMs = 100 } = {}) {
  for (const name of [photodiode, trigger]) {
    if (!recording.channels[name]) throw new Error(`no column "${name}" (have ${Object.keys(recording.channels).join(', ')})`);
  }
  const triggerEdges = detectEdges(recording.time, recording.channels[trigger], { direction: 'rising' });
  const diodeEdges = detectEdges(recording.time, recording.channels[photodiode], { direction: 'both' });
  const pairs = pairEdges(triggerEdges, diodeEdges, windowMs / 1000);
  const interval = ((recording.time.at(-1) - recording.time[0]) / (recording.time.length - 1)) * 1000;
  return { pairs, summary: summarize(pairs.delaysMs), sampleIntervalMs: interval };
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { photodiode: { type: 'string', default: 'photodiode' }, trigger: { type: 'string', default: 'trigger' }, 'window-ms': { type: 'string', default: '100' } } });
  if (!positionals[0]) throw new Error('usage: node tools/timing/analyze.js <recording.csv> [--photodiode name] [--trigger name] [--window-ms 100]');
  const result = analyzeRecording(parseRecording(readFileSync(positionals[0], 'utf8')), { photodiode: values.photodiode, trigger: values.trigger, windowMs: Number(values['window-ms']) });
  console.log(summaryTable([['photodiode edge - trigger edge (ms)', result.summary]]));
  console.log(`\nunmatched trigger edges: ${result.pairs.unmatchedTriggers}, unmatched photodiode edges: ${result.pairs.unmatchedDiode}; sample interval ${result.sampleIntervalMs.toFixed(3)} ms (timing resolution of this recording)`);
}

if (process.argv[1] === import.meta.filename) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
