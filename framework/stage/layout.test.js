import { describe, expect, it } from 'vitest';
import { createRng } from '../foundation/rng.js';
import { createLayout } from './layout.js';

const size = { w: 800, h: 600 };
const toPx = (length) => (typeof length === 'number' ? length * 600 : Number.parseFloat(length));
const layout = (seed = 1) => createLayout({ rng: createRng(seed), size, toPx });

describe('scatter', () => {
  it('returns n stage-coordinate points inside the margin and at least minDistance apart', () => {
    const points = layout().scatter(12, { minDistance: 0.12, margin: 0.06 });
    expect(points).toHaveLength(12);
    for (const { x, y } of points) {
      expect(x * 800).toBeGreaterThanOrEqual(36 - 1e-9);
      expect(x * 800).toBeLessThanOrEqual(800 - 36 + 1e-9);
      expect(y * 600).toBeGreaterThanOrEqual(36 - 1e-9);
      expect(y * 600).toBeLessThanOrEqual(600 - 36 + 1e-9);
    }
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        expect(Math.hypot((points[i].x - points[j].x) * 800, (points[i].y - points[j].y) * 600)).toBeGreaterThanOrEqual(72 - 1e-9);
      }
    }
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const opts = { minDistance: '40px', margin: '20px' };
    expect(layout(5).scatter(6, opts)).toEqual(layout(5).scatter(6, opts));
    expect(layout(5).scatter(6, opts)).not.toEqual(layout(6).scatter(6, opts));
  });

  it('accepts px lengths and zero points', () => {
    expect(layout().scatter(0, { minDistance: '10px', margin: '0px' })).toEqual([]);
    expect(layout().scatter(3, { minDistance: '10px', margin: '0px' })).toHaveLength(3);
  });

  it('throws a descriptive error when the points cannot fit', () => {
    expect(() => layout().scatter(500, { minDistance: 0.5, margin: 0.1, maxAttempts: 2000 })).toThrow(/could not place 500 points/);
  });

  it('throws when the margin leaves no room', () => {
    expect(() => layout().scatter(1, { minDistance: 0.1, margin: 0.6 })).toThrow(/no room/);
  });
});

describe('at and size', () => {
  it('produces CSS percentages for a stage point', () => {
    expect(layout().at({ x: 0.25, y: 0.5 })).toBe('left:25%;top:50%;');
    expect(layout().at({ x: 0.123456, y: 1 })).toBe('left:12.3456%;top:100%;');
  });

  it('exposes a copy of the stage size', () => {
    const l = layout();
    expect(l.size).toEqual({ w: 800, h: 600 });
    l.size.w = 1;
    expect(l.size.w).toBe(800);
  });
});
