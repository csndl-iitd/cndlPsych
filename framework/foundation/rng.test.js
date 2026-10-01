import { describe, expect, it } from 'vitest';
import { createRng } from './rng.js';

const draw = (rng, n) => Array.from({ length: n }, () => rng.next());

describe('createRng', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    expect(draw(createRng(42), 20)).toEqual(draw(createRng(42), 20));
    expect(draw(createRng(42), 5)).not.toEqual(draw(createRng(43), 5));
  });

  it('draws numbers in [0, 1)', () => {
    const values = draw(createRng(7), 5000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('is roughly uniform (10 bins over 100k draws)', () => {
    const bins = new Array(10).fill(0);
    for (const v of draw(createRng(2026), 100_000)) bins[Math.floor(v * 10)] += 1;
    for (const count of bins) expect(Math.abs(count - 10_000)).toBeLessThan(400);
  });

  it('accepts negative and large seeds', () => {
    expect(draw(createRng(-5), 3)).toEqual(draw(createRng(2 ** 32 - 5), 3));
    expect(createRng(12345).seed).toBe(12345);
  });

  it('int() is inclusive of both ends, and rejects bad ranges', () => {
    const rng = createRng(3);
    const values = Array.from({ length: 2000 }, () => rng.int(2, 5));
    expect(new Set(values)).toEqual(new Set([2, 3, 4, 5]));
    expect(rng.int(7, 7)).toBe(7);
    expect(() => rng.int(5, 2)).toThrow(RangeError);
    expect(() => rng.int(1.5, 3)).toThrow(RangeError);
  });

  it('pick() chooses members, and refuses an empty list', () => {
    const rng = createRng(4);
    expect(new Set(Array.from({ length: 200 }, () => rng.pick(['a', 'b', 'c'])))).toEqual(new Set(['a', 'b', 'c']));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffle() returns a permutation without touching the input, and varies', () => {
    const rng = createRng(5);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual(input);
    expect(rng.shuffle(input)).not.toEqual(out);
  });

  it('shuffle() puts every item in every position about equally often', () => {
    const rng = createRng(6);
    const counts = Array.from({ length: 4 }, () => new Array(4).fill(0));
    for (let i = 0; i < 20_000; i += 1) rng.shuffle([0, 1, 2, 3]).forEach((item, position) => { counts[item][position] += 1; });
    for (const row of counts) for (const count of row) expect(Math.abs(count - 5000)).toBeLessThan(300);
  });

  describe('fork', () => {
    it('is stable: the child does not depend on how much the parent has drawn', () => {
      const a = createRng(9);
      const b = createRng(9);
      draw(b, 1000);
      expect(draw(a.fork('stimuli'), 5)).toEqual(draw(b.fork('stimuli'), 5));
    });

    it('differs by label and by seed, and leaves the parent stream alone', () => {
      const rng = createRng(9);
      const before = draw(createRng(9), 3);
      expect(draw(rng.fork('a'), 5)).not.toEqual(draw(rng.fork('b'), 5));
      expect(draw(createRng(9).fork('a'), 5)).not.toEqual(draw(createRng(10).fork('a'), 5));
      expect(draw(rng, 3)).toEqual(before);
    });

    it('forks of forks are stable too', () => {
      expect(draw(createRng(1).fork('block').fork('trial 3'), 4)).toEqual(draw(createRng(1).fork('block').fork('trial 3'), 4));
    });
  });
});
