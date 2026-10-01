import { describe, expect, it } from 'vitest';
import { createRng } from '../../foundation/rng.js';
import { designCells, drawDuration, expandInstances, resolveName } from './plan.js';

const trial = (name, extra = {}) => ({ name, sequence: ['s'], ...extra });
const names = (instances) => instances.map((i) => i.def.name);

describe('resolveName', () => {
  it.each([
    ['target_{side}', { side: 'left' }, 'target_left'],
    ['{a}_{b}', { a: 1, b: true }, '1_true'],
    ['plain', { a: 1 }, 'plain'],
    ['x_{missing}', { a: 1 }, 'x_{missing}'],
    ['{a}{a}', { a: 'z' }, 'zz'],
  ])('%s with %j -> %s', (name, cell, expected) => {
    expect(resolveName(name, cell)).toBe(expected);
  });
});

describe('designCells', () => {
  it('is the full factorial, first factor slowest', () => {
    expect(designCells({ a: [1, 2], b: ['x', 'y', 'z'] })).toHaveLength(6);
    expect(designCells({ a: [1, 2], b: ['x', 'y'] })).toEqual([{ a: 1, b: 'x' }, { a: 1, b: 'y' }, { a: 2, b: 'x' }, { a: 2, b: 'y' }]);
  });
});

describe('expandInstances without a design', () => {
  it('repeats each trial definition and numbers instances from 1', () => {
    const out = expandInstances({ order: 'sequential', trials: [trial('a', { repetitions: 3 }), trial('b')] }, createRng(1));
    expect(names(out)).toEqual(['a', 'a', 'a', 'b']);
    expect(out.map((i) => i.number)).toEqual([1, 2, 3, 4]);
  });

  it('shuffles by default, reproducibly, and keeps every instance', () => {
    const config = { trials: [trial('a', { repetitions: 10 }), trial('b', { repetitions: 10 })] };
    const one = names(expandInstances(config, createRng(7)));
    expect(one).toEqual(names(expandInstances(config, createRng(7))));
    expect(one).not.toEqual(names(expandInstances(config, createRng(8))));
    expect(one.filter((n) => n === 'a')).toHaveLength(10);
    expect(one).not.toEqual([...Array(10).fill('a'), ...Array(10).fill('b')]);
  });

  it('carries the trial conditions', () => {
    const [first] = expandInstances({ order: 'sequential', trials: [trial('a', { conditions: { kind: 'odd' } })] }, createRng(1));
    expect(first.conditions).toEqual({ kind: 'odd' });
    expect(first.cell).toEqual({});
  });
});

describe('expandInstances with a design', () => {
  const design = { factors: { side: ['left', 'right'], load: [1, 2] }, repetitions: 2 };

  it('instantiates one trial per cell and round, with the factor values as conditions', () => {
    const out = expandInstances({ order: 'sequential', design, trials: [trial('t_{side}')] }, createRng(1));
    expect(out).toHaveLength(8);
    expect(out.slice(0, 4).map((i) => i.conditions)).toEqual([
      { side: 'left', load: 1 }, { side: 'left', load: 2 }, { side: 'right', load: 1 }, { side: 'right', load: 2 },
    ]);
  });

  it('applies_to selects cells; trial repetitions multiply', () => {
    const trials = [trial('lefty', { applies_to: { side: 'left' }, repetitions: 2 }), trial('any')];
    const out = expandInstances({ order: 'sequential', design: { factors: { side: ['left', 'right'] } }, trials }, createRng(1));
    expect(names(out)).toEqual(['lefty', 'lefty', 'any', 'any']);
    expect(out.map((i) => i.cell.side)).toEqual(['left', 'left', 'left', 'right']);
  });

  it('merges trial conditions over cell values', () => {
    const [first] = expandInstances({ order: 'sequential', design: { factors: { side: ['left'] } }, trials: [trial('t', { conditions: { note: 'x' } })] }, createRng(1));
    expect(first.conditions).toEqual({ side: 'left', note: 'x' });
  });

  it('max_run: no more than n consecutive instances share a factor value', () => {
    const config = {
      design: { factors: { side: ['left', 'right'] }, repetitions: 10, constraints: [{ max_run: { factor: 'side', n: 2 } }] },
      trials: [trial('t')],
    };
    for (let seed = 1; seed <= 25; seed += 1) {
      const sides = expandInstances(config, createRng(seed)).map((i) => i.cell.side);
      let run = 1;
      for (let i = 1; i < sides.length; i += 1) {
        run = sides[i] === sides[i - 1] ? run + 1 : 1;
        expect(run).toBeLessThanOrEqual(2);
      }
    }
  });

  it('throws when max_run cannot be satisfied, or a sequential order violates it', () => {
    const impossible = { design: { factors: { side: ['left'] }, repetitions: 3, constraints: [{ max_run: { factor: 'side', n: 1 } }] }, trials: [trial('t')] };
    expect(() => expandInstances(impossible, createRng(1))).toThrow(/max_run/);
    expect(() => expandInstances({ ...impossible, order: 'sequential' }, createRng(1))).toThrow(/violates a max_run/);
  });
});

describe('drawDuration', () => {
  it.each([[250, 250], ['1.5s', 1500], [{ frames: 3 }, 48]])('%j -> %d ms', (spec, expected) => {
    expect(drawDuration(spec, createRng(1), 16)).toBe(expected);
  });

  it('draws a [min, max] pair uniformly and reproducibly', () => {
    const rng = createRng(3);
    const draws = Array.from({ length: 2000 }, () => drawDuration([200, 500], rng));
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(200);
    expect(Math.max(...draws)).toBeLessThan(500);
    expect(Math.max(...draws) - Math.min(...draws)).toBeGreaterThan(280);
    expect(drawDuration(['1s', 2000], createRng(4))).toBeGreaterThanOrEqual(1000);
  });

  it('carries the definition index of each instance', () => {
    const out = expandInstances({ order: 'sequential', trials: [trial('a'), trial('b', { repetitions: 2 })] }, createRng(1));
    expect(out.map((i) => i.defIndex)).toEqual([0, 1, 1]);
  });
});
