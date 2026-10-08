import { describe, expect, it } from 'vitest';
import { estimateRefresh } from './refresh.js';

describe('estimateRefresh', () => {
  it('reads 60 Hz from steady frames', () => {
    expect(estimateRefresh(Array(30).fill(16.67))).toEqual({ hz: 60, frameMs: 16.67 });
  });

  it.each([[120, 8.33], [144, 6.94], [75, 13.33]])('reads %i Hz', (hz, interval) => {
    expect(estimateRefresh(Array(30).fill(interval)).hz).toBeCloseTo(hz, 0);
  });

  it('ignores dropped frames and the jitter around the true interval', () => {
    const intervals = [16.5, 16.9, 16.6, 33.3, 16.7, 16.8, 50.1, 16.6, 16.7, 16.7, 16.6, 16.8];
    expect(estimateRefresh(intervals).hz).toBeCloseTo(60, 0);
  });

  it('gives up on too few intervals or on nonsense', () => {
    expect(estimateRefresh([16.7, 16.7])).toBeNull();
    expect(estimateRefresh([0, 0, NaN, 0.5, 0, 0, 0, 0, 0])).toBeNull();
  });
});
