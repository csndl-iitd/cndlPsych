// These tests use SYNTHETIC signals: they check the analysis arithmetic, not any real display or trigger line.
import { describe, expect, it } from 'vitest';
import { analyzeRecording, detectEdges, pairEdges, parseRecording } from './analyze.js';

const RATE = 10_000; // samples per second
const time = (seconds) => Array.from({ length: seconds * RATE }, (_, i) => i / RATE);

/** Square pulses of `width` s starting at each time in `starts`. */
const pulses = (t, starts, width) => t.map((x) => (starts.some((s) => x >= s && x < s + width) ? 1 : 0));
/** A level that flips (0 <-> 1) at each time in `flips`. */
const toggles = (t, flips) => t.map((x) => flips.filter((f) => x >= f).length % 2);

describe('parseRecording', () => {
  it('reads time and named channels', () => {
    expect(parseRecording('time_s,photodiode,trigger\n0,0,0\n0.001,1,0\n')).toEqual({ time: [0, 0.001], channels: { photodiode: [0, 1], trigger: [0, 0] } });
  });

  it('needs time_s first', () => {
    expect(() => parseRecording('t,a\n0,0')).toThrow('time_s');
  });
});

describe('detectEdges', () => {
  it('interpolates the crossing between samples and respects direction', () => {
    const t = [0, 0.001, 0.002, 0.003];
    expect(detectEdges(t, [0, 0, 1, 1])[0]).toBeCloseTo(0.0015, 6);
    expect(detectEdges(t, [0, 0, 1, 1], { direction: 'falling' })).toEqual([]);
    expect(detectEdges(t, [1, 1, 0, 0], { direction: 'falling' })).toHaveLength(1);
  });

  it('finds nothing in a flat signal', () => {
    expect(detectEdges([0, 1, 2], [3, 3, 3])).toEqual([]);
  });
});

describe('pairEdges', () => {
  it('pairs in order and counts what is left over', () => {
    const result = pairEdges([1, 2, 3], [1.02, 2.03, 9], 0.1);
    expect(result.delaysMs.map((d) => Math.round(d))).toEqual([20, 30]);
    expect(result).toMatchObject({ unmatchedTriggers: 1, unmatchedDiode: 1 });
  });

  it('allows the screen to change slightly before the trigger line (negative delay)', () => {
    expect(pairEdges([1], [0.995], 0.1).delaysMs[0]).toBeCloseTo(-5, 5);
  });
});

describe('analyzeRecording', () => {
  it('recovers a known delay and its jitter from synthetic signals', () => {
    const t = time(6);
    const onsets = [0.5, 1.1, 1.7, 2.3, 2.9, 3.5, 4.1, 4.7];
    const delays = [0.0171, 0.0168, 0.0175, 0.0166, 0.0172, 0.0169, 0.0174, 0.0170];
    const recording = { time: t, channels: { trigger: pulses(t, onsets, 0.005), photodiode: toggles(t, onsets.map((o, i) => o + delays[i])) } };
    const { summary, pairs, sampleIntervalMs } = analyzeRecording(recording);
    expect(pairs).toMatchObject({ unmatchedTriggers: 0, unmatchedDiode: 0 });
    expect(summary.n).toBe(8);
    expect(summary.median).toBeCloseTo(17.0, 0);
    expect(summary.min).toBeCloseTo(16.6, 0);
    expect(summary.max).toBeCloseTo(17.5, 0);
    expect(sampleIntervalMs).toBeCloseTo(0.1, 3);
  });

  it('names the columns it has when one is missing', () => {
    expect(() => analyzeRecording({ time: [0, 1], channels: { a: [0, 1] } })).toThrow('no column "photodiode" (have a)');
  });
});
