import { describe, expect, it } from 'vitest';
import { displayBox } from './display-fit.js';

// A phone, upright: 412 x 915, with a border of 84 px all round (tags of 64 px with their quiet zone).
const phone = { w: 412, h: 915 };
const phoneStage = { x: 84, y: 84, w: 244, h: 747 };

describe('displayBox', () => {
  it('is exactly the stage while stimuli run, so display positions are stage positions', () => {
    expect(displayBox(phoneStage, phone, 84, 'stage')).toEqual(phoneStage);
  });

  it('for text on a tall screen reaches the left and right edges, but not into the top and bottom bands where the tags are', () => {
    expect(displayBox(phoneStage, phone, 84, 'text')).toEqual({ x: 0, y: 84, w: 412, h: 747 });
  });

  it('for text on a wide screen reaches the top and bottom edges, but not into the left and right bands', () => {
    const wide = { w: 915, h: 412 };
    expect(displayBox({ x: 84, y: 84, w: 747, h: 244 }, wide, 84, 'text')).toEqual({ x: 84, y: 0, w: 747, h: 412 });
  });

  it('never overlaps a tag: the corner squares of the border are outside the box', () => {
    const box = displayBox(phoneStage, phone, 84, 'text');
    for (const [cx, cy] of [[0, 0], [412 - 84, 0], [0, 915 - 84], [412 - 84, 915 - 84]]) {
      const apart = box.x >= cx + 84 || box.x + box.w <= cx || box.y >= cy + 84 || box.y + box.h <= cy;
      expect(apart, `corner ${cx},${cy}`).toBe(true);
    }
  });

  it('changes nothing without overlays, and stays inside the screen when the stage is close to its edge', () => {
    expect(displayBox({ x: 10, y: 10, w: 392, h: 895 }, phone, 0, 'text')).toEqual({ x: 10, y: 10, w: 392, h: 895 });
    expect(displayBox({ x: 20, y: 84, w: 372, h: 747 }, phone, 84, 'text')).toEqual({ x: 0, y: 84, w: 412, h: 747 });
  });
});
