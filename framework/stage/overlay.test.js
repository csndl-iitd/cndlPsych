import { describe, expect, it } from 'vitest';
import { overlayReserve } from './overlay.js';

const tags = (extra = {}) => ({ apriltags: { enabled: true, size: '64px', margin: '4px', quiet_zone: 1, ...extra } });
const reserve = (spec, shortSide) => overlayReserve(spec, {}, shortSide)(412, 915);

describe('overlayReserve', () => {
  it('is the tag, its quiet zone and the gap to the edge: 64 + 2 x 8 + 4 px on a computer', () => {
    expect(reserve(tags(), 1080)).toBe(84);
    expect(overlayReserve(tags())(1920, 1080)).toBe(84); // no screen size given: not a phone
  });

  it('is smaller on a phone: 60% of the tag size unless phone_size says', () => {
    expect(reserve(tags(), 412)).toBeCloseTo(38 + 2 * (38 / 8) + 4, 5); // 38 px tags
    expect(reserve(tags({ phone_size: '40px' }), 412)).toBe(40 + 2 * 5 + 4);
    expect(reserve(tags({ phone_size: '40px' }), 1080)).toBe(84); // phone_size is for phones only
  });

  it('a phone is a screen whose shorter side is under 600 px, whichever way it is held', () => {
    expect(reserve(tags(), 599)).toBeLessThan(84);
    expect(reserve(tags(), 600)).toBe(84);
  });

  it('is 0 without overlays, and the photodiode patch counts when it is the larger', () => {
    expect(reserve({}, 412)).toBe(0);
    expect(reserve({ apriltags: { enabled: false }, photodiode: { enabled: true, size: '30px' } }, 412)).toBe(30);
    expect(reserve({ ...tags(), photodiode: { enabled: true, size: '100px' } }, 412)).toBe(100);
  });
});
