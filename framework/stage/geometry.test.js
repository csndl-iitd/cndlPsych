import { describe, expect, it } from 'vitest';
import { computeLayout, CSS_PX_PER_MM, inRegion, isEstimated, isInside, lengthToPx, parseAspect, parseTargetId, toStage } from './geometry.js';

describe('parseAspect', () => {
  it.each([['fill', null], [undefined, null], [1.5, 1.5], ['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1]])('%j -> %j', (aspect, expected) => {
    expect(parseAspect(aspect)).toBe(expected);
  });

  it.each([['wide'], ['16:0'], [0], [-1]])('rejects %j', (aspect) => {
    expect(() => parseAspect(aspect)).toThrow(TypeError);
  });
});

describe('computeLayout', () => {
  it.each([
    ['fill uses the whole area', { width: 1000, height: 600, aspect: 'fill' }, { x: 0, y: 0, w: 1000, h: 600 }],
    ['wide viewport, 4:3: pillarbox', { width: 1000, height: 600, aspect: '4:3' }, { x: 100, y: 0, w: 800, h: 600 }],
    ['tall viewport, 4:3: letterbox', { width: 600, height: 1000, aspect: '4:3' }, { x: 0, y: (1000 - 450) / 2, w: 600, h: 450 }],
    ['exact fit', { width: 800, height: 600, aspect: '4:3' }, { x: 0, y: 0, w: 800, h: 600 }],
    ['square on a phone', { width: 390, height: 780, aspect: '1:1' }, { x: 0, y: 195, w: 390, h: 390 }],
    ['margin shrinks the available area', { width: 1000, height: 600, aspect: 'fill', margin: 50 }, { x: 50, y: 50, w: 900, h: 500 }],
    ['margin plus aspect', { width: 1000, height: 600, aspect: '1:1', margin: 50 }, { x: 250, y: 50, w: 500, h: 500 }],
    ['numeric aspect', { width: 1000, height: 500, aspect: 1 }, { x: 250, y: 0, w: 500, h: 500 }],
  ])('%s', (_label, input, expected) => {
    const layout = computeLayout(input);
    for (const key of ['x', 'y', 'w', 'h']) expect(layout[key]).toBeCloseTo(expected[key], 9);
  });

  it('never goes negative when the margin exceeds the area', () => {
    const layout = computeLayout({ width: 100, height: 100, aspect: 'fill', margin: 80 });
    expect(layout.w).toBe(0);
    expect(layout.h).toBe(0);
  });
});

describe('toStage', () => {
  const rect = { x: 100, y: 50, w: 800, h: 600 };
  it.each([
    [100, 50, { x: 0, y: 0 }],
    [900, 650, { x: 1, y: 1 }],
    [500, 350, { x: 0.5, y: 0.5 }],
    [0, 0, { x: -0.125, y: -50 / 600 }],
    [1000, 700, { x: 1.125, y: 650 / 600 }],
  ])('client (%d, %d)', (cx, cy, expected) => {
    const point = toStage(rect, cx, cy);
    expect(point.x).toBeCloseTo(expected.x, 9);
    expect(point.y).toBeCloseTo(expected.y, 9);
  });

  it('knows what is inside the stage', () => {
    expect(isInside({ x: 0, y: 1 })).toBe(true);
    expect(isInside({ x: -0.01, y: 0.5 })).toBe(false);
    expect(isInside({ x: 0.5, y: 1.01 })).toBe(false);
  });
});

describe('lengthToPx', () => {
  const rect = { x: 0, y: 0, w: 800, h: 600 };
  const calibration = { px_per_mm: 4, viewing_distance_mm: 600 };

  it.each([
    [0.1, 60], [1, 600], [0, 0], ['12px', 12], ['2.5px', 2.5], ['10%', 80], ['5mm', 20],
  ])('%j -> %d px', (length, expected) => {
    expect(lengthToPx(length, rect, calibration)).toBeCloseTo(expected, 9);
  });

  it('converts degrees of visual angle with the viewing distance', () => {
    expect(lengthToPx('1deg', rect, calibration)).toBeCloseTo(Math.tan(Math.PI / 180) * 600 * 4, 9);
  });

  it('uses the shorter side of a portrait stage', () => {
    expect(lengthToPx(0.5, { x: 0, y: 0, w: 300, h: 900 })).toBe(150);
  });

  it('estimates mm from the CSS reference pixel without calibration, and says so', () => {
    expect(lengthToPx('10mm', rect)).toBeCloseTo(10 * CSS_PX_PER_MM, 9);
    expect(CSS_PX_PER_MM).toBeCloseTo(3.7795, 4);
    expect(isEstimated('10mm', {})).toBe(true);
    expect(isEstimated('10mm', { px_per_mm: 4 })).toBe(false);
    expect(isEstimated('10px', {})).toBe(false);
    expect(isEstimated(0.1, {})).toBe(false);
  });

  it('refuses deg without px_per_mm and viewing distance, and bad strings', () => {
    expect(() => lengthToPx('1deg', rect)).toThrow(/needs a calibration/);
    expect(() => lengthToPx('1deg', rect, { px_per_mm: 4 })).toThrow(/needs a calibration/);
    expect(() => lengthToPx('five', rect)).toThrow(TypeError);
  });
});

describe('inRegion and parseTargetId', () => {
  it.each([
    [{ x: 0.2, y: 0.9 }, { x: [0, 0.5] }, true],
    [{ x: 0.6, y: 0.9 }, { x: [0, 0.5] }, false],
    [{ x: 0.6, y: 0.9 }, { y: [0.5, 1] }, true],
    [{ x: 0.5, y: 0.5 }, { x: [0.5, 0.5], y: [0, 1] }, true],
    [{ x: 0.2, y: 0.2 }, {}, true],
    [{ x: 0.2, y: 0.2 }, undefined, true],
  ])('%j in %j -> %s', (pt, region, expected) => {
    expect(inRegion(pt, region)).toBe(expected);
  });

  it.each([['3', 3], ['-1', -1], ['a1', 'a1'], ['1.5', '1.5'], ['', '']])('data-id %j -> %j', (value, expected) => {
    expect(parseTargetId(value)).toBe(expected);
  });
});
