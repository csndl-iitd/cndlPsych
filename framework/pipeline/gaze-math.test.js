import { describe, expect, it } from 'vitest';
import { createRng } from '../foundation/rng.js';
import { calibrationPoints, createDwell, createPresence, createThrottle, MAX_VALIDATION_POINTS, validationPoints, validationStats } from './gaze-math.js';

describe('calibrationPoints', () => {
  it.each([5, 9, 13])('gives %i distinct points inside the stage, in a seeded order', (count) => {
    const points = calibrationPoints(count, createRng(1));
    expect(points).toHaveLength(count);
    expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(count);
    expect(points.every((p) => p.x >= 0.1 && p.x <= 0.9 && p.y >= 0.1 && p.y <= 0.9)).toBe(true);
    expect(calibrationPoints(count, createRng(1))).toEqual(points);
  });

  it('covers the same points whatever the order, and different seeds give different orders', () => {
    const key = (list) => list.map((p) => `${p.x},${p.y}`);
    expect(key(calibrationPoints(9, createRng(1))).sort()).toEqual(key(calibrationPoints(9, createRng(2))).sort());
    expect(key(calibrationPoints(9, createRng(1)))).not.toEqual(key(calibrationPoints(9, createRng(2))));
  });

  it('refuses other counts', () => {
    expect(() => calibrationPoints(7, createRng(1))).toThrow('5, 9 or 13');
  });
});

describe('validationPoints', () => {
  it('uses points away from the calibration grid and is capped', () => {
    const calibration = new Set(calibrationPoints(13, createRng(1)).map((p) => `${p.x},${p.y}`));
    const points = validationPoints(8);
    expect(points).toHaveLength(8);
    expect(points.every((p) => !calibration.has(`${p.x},${p.y}`))).toBe(true);
    expect(validationPoints(99)).toHaveLength(MAX_VALIDATION_POINTS);
  });
});

describe('validationStats', () => {
  const trial = (target, offsets) => ({ target, samples: offsets.map(([dx, dy]) => ({ cx: target.cx + dx, cy: target.cy + dy })) });

  it('accuracy is the distance of the median prediction from the target', () => {
    const stats = validationStats([trial({ cx: 100, cy: 100 }, [[30, 40], [30, 40], [30, 40]]), trial({ cx: 500, cy: 500 }, [[0, 0], [0, 0], [0, 0]])], 1000);
    expect(stats).toMatchObject({ enough: true, points: 2, mean_error_px: 25 });
    expect(stats.precision_px).toBe(0);
  });

  it('is robust to one wild prediction (median), while precision shows the scatter', () => {
    const stats = validationStats([trial({ cx: 0, cy: 0 }, [[10, 0], [10, 0], [10, 0], [10, 0], [900, 0]])], 1000);
    expect(stats.mean_error_px).toBe(10);
    expect(stats.precision_px).toBeGreaterThan(100);
  });

  it('precision is the RMS distance from the mean prediction', () => {
    const stats = validationStats([trial({ cx: 0, cy: 0 }, [[-3, 0], [3, 0], [0, -3], [0, 3]])], 1000);
    expect(stats.precision_px).toBeCloseTo(3);
    expect(stats.mean_error_px).toBeCloseTo(0);
  });

  it('ignores a target with too few predictions, and fails with the fallback when under half have data', () => {
    const good = trial({ cx: 0, cy: 0 }, [[1, 0], [1, 0], [1, 0]]);
    const none = { target: { cx: 9, cy: 9 }, samples: [] };
    expect(validationStats([good, good, none], 777)).toMatchObject({ enough: true, points: 2 });
    expect(validationStats([good, none, none], 777)).toEqual({ points: 1, mean_error_px: 777, precision_px: 777, enough: false });
    expect(validationStats([], 777).enough).toBe(false);
  });
});

describe('createThrottle', () => {
  it('lets through about hz samples per second from a faster stream', () => {
    const accept = createThrottle(30);
    let kept = 0;
    for (let t = 0; t < 1000; t += 8) if (accept(t)) kept += 1; // 125 Hz in
    expect(kept).toBeGreaterThanOrEqual(25);
    expect(kept).toBeLessThanOrEqual(32);
  });

  it('accepts the first sample', () => {
    expect(createThrottle(10)(0)).toBe(true);
  });
});

describe('createDwell', () => {
  const run = (feed, points) => points.map(([t, cx, cy]) => feed({ t, cx, cy })).filter(Boolean);

  it('fires once when the gaze has stayed within the radius for min_ms, with the centroid', () => {
    const found = run(createDwell({ radiusPx: 20, minMs: 100 }), [[0, 100, 100], [40, 104, 100], [80, 96, 100], [100, 100, 104], [140, 100, 100], [180, 101, 99]]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ t_start: 0, t_end: 100, duration_ms: 100 });
    expect(found[0].cx).toBeCloseTo(100, 0);
  });

  it('does not fire for a gaze that keeps moving, and starts over after a jump', () => {
    const feed = createDwell({ radiusPx: 10, minMs: 100 });
    expect(run(feed, [[0, 0, 0], [50, 30, 0], [100, 60, 0], [150, 90, 0]])).toEqual([]);
    const found = run(feed, [[200, 500, 500], [260, 502, 500], [320, 500, 501]]);
    expect(found).toHaveLength(1);
    expect(found[0].t_start).toBe(200);
  });

  it('fires again for a second fixation elsewhere', () => {
    const feed = createDwell({ radiusPx: 10, minMs: 50 });
    const first = run(feed, [[0, 0, 0], [60, 0, 0], [80, 0, 0]]);
    const second = run(feed, [[100, 300, 300], [170, 300, 300]]);
    expect([first.length, second.length]).toEqual([1, 1]);
  });
});

describe('createPresence', () => {
  it('reports lost after lostMs without a prediction, and regained once', () => {
    const presence = createPresence({ lostMs: 500 });
    expect(presence.feed(0, true)).toBeNull();
    expect(presence.feed(300, false)).toBeNull();
    expect(presence.feed(600, false)).toBe('lost');
    expect(presence.feed(700, false)).toBeNull();
    expect(presence.lost).toBe(true);
    expect(presence.feed(800, true)).toBe('regained');
    expect(presence.feed(900, true)).toBeNull();
  });

  it('a short dropout is not a loss', () => {
    const presence = createPresence({ lostMs: 500 });
    presence.feed(0, true);
    expect(presence.feed(200, false)).toBeNull();
    expect(presence.feed(300, true)).toBeNull();
  });

  it('tick detects a loss when the engine stops calling back', () => {
    const presence = createPresence({ lostMs: 500 });
    presence.feed(0, true);
    expect(presence.tick(400)).toBeNull();
    expect(presence.tick(600)).toBe('lost');
  });
});
