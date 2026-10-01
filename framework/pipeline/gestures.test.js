import { beforeEach, describe, expect, it } from 'vitest';
import { createRecognizer } from './gestures.js';

// A 1000 x 500 px stage at the origin: shorter side 500. Targets are boxes in client px.
const TARGETS = [
  { ref: { id: 1, role: 'target' }, box: { left: 100, right: 200, top: 100, bottom: 200 } },
  { ref: { id: 2, role: 'distractor' }, box: { left: 600, right: 700, top: 100, bottom: 200 } },
];

function setup(config = {}) {
  const env = { time: 0, events: [], timers: [] };
  const recognizer = createRecognizer({
    emit: (type, data, t) => env.events.push({ type, data, t }),
    now: () => env.time,
    hit: (cx, cy, padding) => {
      const found = TARGETS.find(({ box }) => cx >= box.left - padding && cx <= box.right + padding && cy >= box.top - padding && cy <= box.bottom + padding);
      return found ?? null;
    },
    toPx: (length) => (typeof length === 'number' ? length * 500 : Number.parseFloat(length)),
    shorterSide: () => 500,
    schedule: (ms, callback) => {
      const timer = { at: env.time + ms, callback, cancelled: false };
      env.timers.push(timer);
      return () => { timer.cancelled = true; };
    },
  });
  recognizer.configure({ gestures: ['tap'], ...config });

  const sample = (phase, t, cx, cy, extra = {}) => ({
    phase, id: 1, t, cx, cy, x: cx / 1000, y: cy / 500, pointerType: 'touch', trusted: true, ...extra,
  });
  return {
    env,
    recognizer,
    types: () => env.events.map((e) => e.type),
    of: (type) => env.events.filter((e) => e.type === type).map((e) => e.data),
    send: (phase, t, cx, cy, extra) => recognizer.pointer(sample(phase, t, cx, cy, extra)),
    /** Advance the clock, firing due timers. */
    advance(to) {
      for (const timer of env.timers.filter((candidate) => !candidate.cancelled && candidate.at <= to).sort((a, b) => a.at - b.at)) {
        env.time = timer.at;
        timer.cancelled = true;
        timer.callback();
      }
      env.time = to;
    },
  };
}

describe('tap', () => {
  it('is a quick press and release without movement, with the documented fields', () => {
    const t = setup();
    t.send('down', 1000, 150, 150, { pressure: 0.5 });
    t.send('up', 1080, 151, 150);
    expect(t.types()).toEqual(['input.tap']);
    expect(t.of('input.tap')[0]).toEqual({
      gesture_id: 1, pointer_type: 'touch', t_down: 1000, t_up: 1080, duration_ms: 80,
      down: { x: 0.15, y: 0.3, cx: 150, cy: 150 }, up: { x: 0.151, y: 0.3, cx: 151, cy: 150 },
      slop: 1, target: { id: 1, role: 'target' }, up_target: { id: 1, role: 'target' }, tap_index: 1, pressure: 0.5, all_trusted: true,
    });
  });

  it('is emitted at the release time', () => {
    const t = setup();
    t.send('down', 1000, 10, 10);
    t.send('up', 1100, 10, 10);
    expect(t.env.events[0].t).toBe(1100);
  });

  it('reports a null target when nothing is hit, and the nearest target within hit_padding', () => {
    const t = setup();
    t.send('down', 0, 400, 400);
    t.send('up', 50, 400, 400);
    expect(t.of('input.tap')[0].target).toBeNull();

    const padded = setup({ hitPaddingPx: 20 });
    padded.send('down', 0, 215, 150);
    padded.send('up', 50, 215, 150);
    expect(padded.of('input.tap')[0].target).toEqual({ id: 1, role: 'target' });
  });

  it('is not a tap when held too long or moved too far (default 500 ms / 10 px)', () => {
    const slow = setup();
    slow.send('down', 0, 10, 10);
    slow.send('up', 600, 10, 10);
    expect(slow.types()).toEqual([]);

    const moved = setup();
    moved.send('down', 0, 10, 10);
    moved.send('move', 20, 30, 10);
    moved.send('up', 40, 10, 10);
    expect(moved.types()).toEqual([]);
  });

  it('honours custom thresholds', () => {
    const t = setup({ gesture_thresholds: { tap: { max_duration: '1s', slop: 0.1 } } });
    t.send('down', 0, 10, 10);
    t.send('move', 20, 40, 10);
    t.send('up', 800, 40, 10);
    expect(t.types()).toEqual(['input.tap']);
    expect(t.of('input.tap')[0].slop).toBe(30);
  });

  it('with fire_on down, fires at the press with up equal to down', () => {
    const t = setup({ fire_on: 'down' });
    t.send('down', 500, 150, 150);
    expect(t.types()).toEqual(['input.tap']);
    expect(t.env.events[0].t).toBe(500);
    expect(t.of('input.tap')[0]).toMatchObject({ duration_ms: 0, t_up: 500, slop: 0 });
    t.send('up', 560, 150, 150);
    expect(t.types()).toEqual(['input.tap']);
  });

  it('counts quick repeated taps nearby (tap_index, interval_ms) and starts over after a pause', () => {
    const t = setup();
    for (const [down, up] of [[0, 50], [200, 250], [400, 450]]) {
      t.send('down', down, 150, 150);
      t.send('up', up, 150, 150);
    }
    expect(t.of('input.tap').map((tap) => [tap.tap_index, tap.interval_ms])).toEqual([[1, undefined], [2, 150], [3, 150]]);
    t.send('down', 2000, 150, 150);
    t.send('up', 2050, 150, 150);
    expect(t.of('input.tap').at(-1).tap_index).toBe(1);
    t.send('down', 2200, 900, 400);
    t.send('up', 2250, 900, 400);
    expect(t.of('input.tap').at(-1).tap_index).toBe(1);
  });

  it('is only all_trusted when every pointer event was trusted', () => {
    const trusted = setup();
    trusted.send('down', 0, 10, 10);
    trusted.send('up', 50, 10, 10);
    expect(trusted.of('input.tap')[0].all_trusted).toBe(true);

    const synthetic = setup();
    synthetic.send('down', 0, 10, 10);
    synthetic.send('up', 50, 10, 10, { trusted: false });
    expect(synthetic.of('input.tap')[0].all_trusted).toBe(false);
  });

  it('ignores a second pointer while one is active, and does nothing when no gesture is enabled', () => {
    const t = setup();
    t.send('down', 0, 10, 10);
    t.recognizer.pointer({ ...{ phase: 'down', id: 2, t: 10, cx: 500, cy: 300, x: 0.5, y: 0.6, pointerType: 'touch', trusted: true } });
    t.recognizer.pointer({ phase: 'up', id: 2, t: 30, cx: 500, cy: 300, x: 0.5, y: 0.6, pointerType: 'touch', trusted: true });
    t.send('up', 50, 10, 10);
    expect(t.of('input.tap')).toHaveLength(1);

    const off = setup({ gestures: [] });
    off.send('down', 0, 10, 10);
    off.send('up', 50, 10, 10);
    expect(off.types()).toEqual([]);
  });
});

describe('longpress', () => {
  let t;
  beforeEach(() => { t = setup({ gestures: ['tap', 'longpress'] }); });

  it('fires start at the threshold and end on release, suppressing the tap', () => {
    t.send('down', 0, 150, 150);
    t.advance(500);
    expect(t.types()).toEqual(['input.longpress.start']);
    expect(t.of('input.longpress.start')[0]).toMatchObject({ gesture_id: 1, t_down: 0, t_fire: 500, threshold_ms: 500, target: { id: 1, role: 'target' } });
    t.send('up', 900, 150, 150);
    expect(t.types()).toEqual(['input.longpress.start', 'input.longpress.end']);
    expect(t.of('input.longpress.end')[0]).toMatchObject({ duration_ms: 900, tap_suppressed: true, all_trusted: true, slop: 0 });
  });

  it('is a tap when released before the threshold', () => {
    t.send('down', 0, 150, 150);
    t.send('up', 200, 150, 150);
    t.advance(1000);
    expect(t.types()).toEqual(['input.tap']);
  });

  it('is cancelled by moving beyond the slop before the threshold', () => {
    t.send('down', 0, 150, 150);
    t.send('move', 100, 200, 150);
    t.advance(1000);
    t.send('up', 1100, 200, 150);
    expect(t.types()).toEqual([]);
  });

  it('reports tap_suppressed false when taps are not enabled', () => {
    const only = setup({ gestures: ['longpress'], gesture_thresholds: { longpress: { min_duration: 300 } } });
    only.send('down', 0, 10, 10);
    only.advance(300);
    only.send('up', 400, 10, 10);
    expect(only.of('input.longpress.end')[0].tap_suppressed).toBe(false);
    expect(only.of('input.longpress.start')[0].threshold_ms).toBe(300);
  });

  it('does not fire after a pointer cancel', () => {
    t.send('down', 0, 10, 10);
    t.send('cancel', 100, 10, 10);
    t.advance(1000);
    expect(t.types()).toEqual([]);
  });
});

describe('swipe', () => {
  const swipe = (t, { from = [100, 250], to = [400, 250], start = 0, end = 150 } = {}) => {
    t.send('down', start, ...from);
    const steps = 5;
    for (let i = 1; i < steps; i += 1) {
      t.send('move', start + ((end - start) * i) / steps, from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    }
    t.send('up', end, ...to);
  };

  it('reports a fast, long enough movement with direction, distance and velocities', () => {
    const t = setup({ gestures: ['swipe'] });
    swipe(t);
    expect(t.types()).toEqual(['input.swipe']);
    const [event] = t.of('input.swipe');
    expect(event).toMatchObject({ gesture_id: 1, t_down: 0, t_up: 150, duration_ms: 150, dx: 300, dy: 0, distance: 300, direction: 'right', direction_rad: 0, straightness: 1, all_trusted: true });
    expect(event.mean_velocity).toBeCloseTo(300 / 500 / 0.15, 2);
    expect(event.end_velocity).toBeGreaterThan(0);
    expect(event.peak_velocity).toBeGreaterThan(0);
  });

  it.each([
    [[400, 250], [100, 250], 'left'], [[250, 400], [250, 100], 'up'], [[250, 100], [250, 400], 'down'], [[100, 100], [400, 160], 'right'],
  ])('direction from %j to %j is %s', (from, to, expected) => {
    const t = setup({ gestures: ['swipe'] });
    swipe(t, { from, to });
    expect(t.of('input.swipe')[0].direction).toBe(expected);
  });

  it.each([
    ['too short (under 40 px)', { to: [120, 250] }],
    ['too slow (under 0.2 stage lengths / s)', { to: [140, 250], end: 900 }],
    ['too long (over 1 s)', { to: [900, 250], end: 1500 }],
  ])('is not a swipe when %s', (_label, options) => {
    const t = setup({ gestures: ['swipe'] });
    swipe(t, options);
    expect(t.types()).toEqual([]);
  });

  it('prefers swipe over tap when enabled together, and tap over nothing for a small movement', () => {
    const t = setup({ gestures: ['tap', 'swipe'] });
    swipe(t);
    expect(t.types()).toEqual(['input.swipe']);
    t.send('down', 1000, 10, 10);
    t.send('up', 1050, 10, 10);
    expect(t.types()).toEqual(['input.swipe', 'input.tap']);
  });

  it('measures straightness for a curved path', () => {
    const t = setup({ gestures: ['swipe'] });
    t.send('down', 0, 100, 250);
    t.send('move', 50, 250, 100);
    t.send('up', 100, 400, 250);
    expect(t.of('input.swipe')[0].straightness).toBeLessThan(0.8);
  });
});

describe('drag', () => {
  it('starts after the slop, ends with displacement and path length, with the grab offset', () => {
    const t = setup({ gestures: ['drag'] });
    t.send('down', 0, 110, 110);
    t.send('move', 50, 114, 110);
    expect(t.types()).toEqual([]);
    t.send('move', 100, 150, 110);
    expect(t.types()).toEqual(['input.drag.start']);
    expect(t.of('input.drag.start')[0]).toMatchObject({ gesture_id: 1, t_down: 0, t_start: 100, target: { id: 1, role: 'target' }, grab_offset: { x: -40, y: -40 } });
    t.send('move', 200, 650, 150);
    t.send('up', 300, 650, 150);
    expect(t.types()).toEqual(['input.drag.start', 'input.drag.end']);
    const [end] = t.of('input.drag.end');
    expect(end).toMatchObject({ duration_ms: 300, target: { id: 1, role: 'target' }, drop_target: { id: 2, role: 'distractor' }, all_trusted: true });
    expect(end.displacement).toBeCloseTo(Math.hypot(540, 40), 2);
    expect(end.path_length).toBeGreaterThanOrEqual(end.displacement);
  });

  it('is a tap, not a drag, when the pointer stays within the slop', () => {
    const t = setup({ gestures: ['tap', 'drag'] });
    t.send('down', 0, 110, 110);
    t.send('move', 20, 115, 110);
    t.send('up', 50, 115, 110);
    expect(t.types()).toEqual(['input.tap']);
  });

  it('wins over swipe when both are enabled', () => {
    const t = setup({ gestures: ['swipe', 'drag'] });
    t.send('down', 0, 100, 250);
    t.send('move', 50, 250, 250);
    t.send('up', 100, 400, 250);
    expect(t.types()).toEqual(['input.drag.start', 'input.drag.end']);
  });

  it.each([['pointer_cancel', (t) => t.send('cancel', 200, 300, 300)], ['blur', (t) => t.recognizer.cancel('blur')], ['phase_end', (t) => t.recognizer.cancel('phase_end')]])('is cancelled with reason %s', (reason, cancel) => {
    const t = setup({ gestures: ['drag'] });
    t.send('down', 0, 100, 250);
    t.send('move', 50, 250, 250);
    cancel(t);
    expect(t.of('input.drag.cancel')).toEqual([{ gesture_id: 1, reason }]);
    t.send('up', 300, 300, 250);
    expect(t.types()).toEqual(['input.drag.start', 'input.drag.cancel']);
  });

  it('rejects an unknown cancel reason, and reconfiguring ends a gesture in progress', () => {
    const t = setup({ gestures: ['drag'] });
    t.send('down', 0, 100, 250);
    t.send('move', 50, 250, 250);
    expect(() => t.recognizer.cancel('bored')).toThrow(RangeError);
    t.recognizer.configure({ gestures: ['tap'] });
    expect(t.of('input.drag.cancel')[0].reason).toBe('phase_end');
  });
});

describe('pointer paths', () => {
  it('are off by default and opt-in per scope', () => {
    const off = setup({ gestures: ['drag'] });
    off.send('down', 0, 100, 250);
    off.send('move', 50, 250, 250);
    off.send('up', 100, 250, 250);
    expect(off.of('input.pointer.path')).toEqual([]);

    const on = setup({ gestures: ['drag'], pointer_path: true });
    on.send('down', 0, 100, 250, { pressure: 0.4 });
    on.send('move', 50, 250, 250);
    on.send('up', 100, 250, 250);
    expect(on.of('input.pointer.path')).toEqual([{ gesture_id: 1, samples: [[0, 0.1, 0.5, 0.4], [50, 0.25, 0.5], [100, 0.25, 0.5]] }]);
  });

  it('can be decimated by hz and are chunked in 256-row pieces', () => {
    const slow = setup({ gestures: ['drag'], pointer_path: { hz: 10 } });
    slow.send('down', 0, 100, 250);
    for (let i = 1; i <= 100; i += 1) slow.send('move', i * 10, 100 + i, 250);
    slow.send('up', 1010, 200, 250);
    expect(slow.of('input.pointer.path')[0].samples.length).toBeLessThanOrEqual(12);

    const long = setup({ gestures: ['drag'], pointer_path: true });
    long.send('down', 0, 100, 250);
    for (let i = 1; i <= 600; i += 1) long.send('move', i, 100 + (i % 300), 250);
    long.send('up', 601, 200, 250);
    expect(long.of('input.pointer.path').map((chunk) => chunk.samples.length)).toEqual([256, 256, 90]);
  });
});
