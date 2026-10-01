import { describe, expect, it } from 'vitest';
import { createClock, durationMs, nextFrame } from './clock.js';

describe('createClock', () => {
  const source = { now: () => 1500, timeOrigin: 1_790_766_000_000, timezone: 'Asia/Calcutta' };

  it('reports page time and maps it to wall time', () => {
    const clock = createClock(source);
    expect(clock.now()).toBe(1500);
    expect(clock.toWall(250)).toBe(1_790_766_000_250);
  });

  it('anchors page time to the wall clock', () => {
    const anchor = createClock(source).anchor();
    expect(anchor.time_origin_ms).toBe(1_790_766_000_000);
    expect(anchor.wall_iso).toBe(new Date(1_790_766_001_500).toISOString());
    expect(anchor.timezone).toBe('Asia/Calcutta');
    expect(Number.isInteger(anchor.utc_offset_min)).toBe(true);
  });

  it('derives the origin from the wall clock when the platform gives none', () => {
    const clock = createClock({ now: () => 100, wallNow: () => 1_000_100, timeOrigin: undefined });
    expect(clock.toWall(0)).toBe(clock.anchor().time_origin_ms);
  });

  it('defaults to performance.now()', () => {
    const clock = createClock();
    const a = clock.now();
    const b = clock.now();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('nextFrame', () => {
  it('resolves with the animation frame timestamp', async () => {
    const raf = (callback) => setTimeout(() => callback(16.7), 0);
    expect(await nextFrame(raf)).toBe(16.7);
  });
});

describe('durationMs', () => {
  it.each([
    [250, undefined, 250],
    [0, undefined, 0],
    ['200ms', undefined, 200],
    ['1.5s', undefined, 1500],
    ['5 s', undefined, 5000],
    [{ frames: 3 }, 16, 48],
  ])('%j -> %d ms', (value, frameMs, expected) => {
    expect(durationMs(value, frameMs)).toBe(expected);
  });

  it.each([['soon'], ['5 minutes'], [{ frames: 2 }], [null], [[1, 2]]])('rejects %j', (value) => {
    expect(() => durationMs(value)).toThrow(TypeError);
  });
});
