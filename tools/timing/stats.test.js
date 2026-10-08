import { describe, expect, it } from 'vitest';
import { percentile, summarize, summaryTable } from './stats.js';

describe('percentile', () => {
  it('interpolates between neighbours', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 25)).toBe(20);
    expect(percentile([5], 95)).toBe(5);
  });

  it('does not depend on the order of the input, and the input is not changed', () => {
    const input = [9, 1, 5];
    expect(percentile(input, 50)).toBe(5);
    expect(input).toEqual([9, 1, 5]);
  });

  it('is NaN for nothing', () => {
    expect(percentile([], 50)).toBeNaN();
  });
});

describe('summarize', () => {
  it('gives min, median, p95, p99, max over the finite values', () => {
    const values = Array.from({ length: 101 }, (_, i) => i);
    expect(summarize([...values, NaN, undefined])).toEqual({ n: 101, min: 0, median: 50, p95: 95, p99: 99, max: 100 });
  });
});

it('summaryTable renders rows and n/a for missing data', () => {
  const table = summaryTable([['x', summarize([1, 2, 3])], ['none', summarize([])]]);
  expect(table.split('\n')[2]).toBe('| x | 3 | 1.00 | 2.00 | 2.90 | 2.98 | 3.00 |');
  expect(table.split('\n')[3]).toContain('n/a');
});
