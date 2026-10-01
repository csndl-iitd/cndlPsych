import { describe, expect, it } from 'vitest';
import { createCursor } from './cursor.js';

function setup() {
  const element = { style: { cursor: '' } };
  const timers = [];
  const cursor = createCursor({
    element,
    schedule: (ms, callback) => {
      const timer = { ms, callback, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
  });
  const fire = () => timers.filter((t) => !t.cancelled).forEach((t) => { t.cancelled = true; t.callback(); });
  const mouse = (cx, cy) => cursor.moved({ cx, cy, pointer_type: 'mouse' });
  return { element, cursor, timers, fire, mouse };
}

describe('cursor', () => {
  it('hides after autohide_ms (default 1000) without movement', () => {
    const { element, cursor, timers, fire, mouse } = setup();
    mouse(10, 10);
    expect(timers.at(-1).ms).toBe(1000);
    expect(cursor.hidden).toBe(false);
    fire();
    expect(cursor.hidden).toBe(true);
    expect(element.style.cursor).toBe('none');
  });

  it('restarts the timer on every movement', () => {
    const { timers, mouse } = setup();
    mouse(10, 10);
    mouse(20, 10);
    expect(timers.filter((t) => !t.cancelled)).toHaveLength(1);
  });

  it('comes back only after moving show_on_move_px (default 3)', () => {
    const { element, cursor, fire, mouse } = setup();
    mouse(10, 10);
    fire();
    mouse(11, 11);
    expect(cursor.hidden).toBe(true);
    mouse(13, 10);
    expect(cursor.hidden).toBe(false);
    expect(element.style.cursor).toBe('');
  });

  it('measures the shown distance from where it was hidden, not from the last jitter', () => {
    const { cursor, fire, mouse } = setup();
    mouse(10, 10);
    fire();
    for (const x of [11, 12, 11, 12]) mouse(x, 10);
    expect(cursor.hidden).toBe(true);
  });

  it('ignores touch and pen', () => {
    const { cursor, timers } = setup();
    cursor.moved({ cx: 1, cy: 1, pointer_type: 'touch' });
    cursor.moved({ cx: 1, cy: 1, pointer_type: 'pen' });
    expect(timers).toHaveLength(0);
  });

  it('honours configure: custom values, and autohide_ms 0 disables hiding', () => {
    const { cursor, timers, fire, mouse } = setup();
    cursor.configure({ autohide_ms: 250, show_on_move_px: 10 });
    mouse(0, 0);
    expect(timers.at(-1).ms).toBe(250);
    fire();
    mouse(5, 0);
    expect(cursor.hidden).toBe(true);
    mouse(10, 0);
    expect(cursor.hidden).toBe(false);

    cursor.configure({ autohide_ms: 0 });
    const before = timers.length;
    mouse(50, 50);
    expect(timers).toHaveLength(before);
  });

  it('configure(autohide_ms: 0) brings a hidden cursor back, and dispose restores it', () => {
    const { element, cursor, fire, mouse } = setup();
    mouse(0, 0);
    fire();
    cursor.configure({ autohide_ms: 0 });
    expect(cursor.hidden).toBe(false);
    cursor.configure({});
    mouse(0, 0);
    fire();
    cursor.dispose();
    expect(element.style.cursor).toBe('');
  });
});
