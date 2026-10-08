import { describe, expect, it } from 'vitest';
import { createFrames } from './frames.js';

const FRAME = 1000 / 60;

/** A display we drive by hand: frames at chosen timestamps, and a macrotask queue that runs between them. */
function display() {
  let callbacks = [];
  let macrotasks = [];
  return {
    requestFrame: (callback) => { callbacks.push(callback); return callbacks.length; },
    cancelFrame: () => { callbacks = []; },
    schedule: (_ms, callback) => { const task = { callback }; macrotasks.push(task); return () => { macrotasks = macrotasks.filter((t) => t !== task); }; },
    /** Deliver a frame at `timestamp`, then let the macrotasks run. */
    frame(timestamp) {
      const due = callbacks;
      callbacks = [];
      due.forEach((callback) => callback(timestamp));
    },
    macrotask() {
      const due = macrotasks;
      macrotasks = [];
      due.forEach((task) => task.callback());
    },
    get pending() { return callbacks.length; },
  };
}

const setup = () => {
  const screen = display();
  const clock = { t: 0 };
  return { screen, clock, frames: createFrames({ ...screen, frameMs: FRAME, now: () => clock.t }) };
};

describe('after', () => {
  it('fires in the frame whose timestamp reaches the target, and with that timestamp', () => {
    const { screen, frames } = setup();
    const fired = [];
    frames.after(0, 6, (timestamp) => fired.push(timestamp));
    for (let i = 1; i <= 8; i += 1) screen.frame(i * FRAME);
    expect(fired).toEqual([6 * FRAME]);
  });

  it('accepts a frame that is up to half a frame early, not one that is a whole frame early', () => {
    const { screen, frames } = setup();
    const fired = [];
    frames.after(0, 6, (timestamp) => fired.push(timestamp));
    screen.frame(5 * FRAME);
    expect(fired).toEqual([]);
    screen.frame(6 * FRAME - FRAME / 2 + 0.01);
    expect(fired).toHaveLength(1);
  });

  it('a dropped frame delays the end by the late frame, it does not change how targets are counted', () => {
    const { screen, frames } = setup();
    const fired = [];
    frames.after(0, 6, (timestamp) => fired.push(timestamp));
    screen.frame(2 * FRAME);
    screen.frame(9 * FRAME); // the browser skipped frames 3-8
    expect(fired).toEqual([9 * FRAME]);
  });

  it('chained phases, each aimed at its own onset frame, last exactly their frames on a steady display', async () => {
    const { screen, frames } = setup();
    const onsets = [];
    const chain = (onset, counts) => {
      onsets.push(onset);
      if (counts.length) frames.after(onset, counts[0], (timestamp) => chain(timestamp, counts.slice(1)));
    };
    frames.next().then((t) => chain(t, [6, 6, 3, 6]));
    for (let i = 1; i <= 40; i += 1) {
      screen.frame(i * FRAME);
      await Promise.resolve(); // the first onset arrives through a promise
    }
    expect(onsets.slice(1).map((t, i) => Math.round((t - onsets[i]) / FRAME))).toEqual([6, 6, 3, 6]);
  });

  it('can be cancelled, and the loop stops when nothing is waiting', () => {
    const { screen, frames } = setup();
    const fired = [];
    const cancel = frames.after(0, 2, () => fired.push(1));
    cancel();
    expect(screen.pending).toBe(0);
    screen.frame(10 * FRAME);
    expect(fired).toEqual([]);
  });

  it('keeps asking for frames only while jobs wait', () => {
    const { screen, frames } = setup();
    frames.after(0, 2, () => {});
    screen.frame(FRAME);
    expect(screen.pending).toBe(1);
    screen.frame(2 * FRAME);
    expect(screen.pending).toBe(0);
  });
});

describe('frameTimestamp', () => {
  it('is the frame time while the callback runs and for the work that follows, and null after the next macrotask', () => {
    const { screen, frames } = setup();
    let inside = null;
    let microtask = null;
    frames.after(0, 1, () => {
      inside = frames.frameTimestamp;
      queueMicrotask(() => { microtask = frames.frameTimestamp; });
    });
    expect(frames.frameTimestamp).toBeNull();
    screen.frame(FRAME);
    return Promise.resolve().then(() => {
      expect(inside).toBe(FRAME);
      expect(microtask).toBe(FRAME);
      expect(frames.frameTimestamp).toBe(FRAME);
      screen.macrotask();
      expect(frames.frameTimestamp).toBeNull();
    });
  });
});

describe('a callback that runs late', () => {
  it('gets its timestamp moved on by the whole frames it was late, so stamps and later targets follow the real frame', () => {
    const { screen, clock, frames } = setup();
    const seen = [];
    frames.after(0, 1, (timestamp) => seen.push(timestamp));
    clock.t = 5 * FRAME + 3; // the page was blocked until now (4 whole frames after the timestamp); the browser still passes the old frame time
    screen.frame(FRAME);
    expect(seen[0]).toBeCloseTo(5 * FRAME);
  });

  it('leaves an ordinary callback alone, even when it runs part of a frame after its timestamp', () => {
    const { screen, clock, frames } = setup();
    const seen = [];
    frames.after(0, 1, (timestamp) => seen.push(timestamp));
    clock.t = FRAME + 9;
    screen.frame(FRAME);
    expect(seen).toEqual([FRAME]);
  });

  it('a phase that starts on the late frame is aimed from the moved timestamp, so it keeps its full length', () => {
    const { screen, clock, frames } = setup();
    const ends = [];
    frames.after(0, 6, (onset) => frames.after(onset, 6, (end) => ends.push([onset, end])));
    clock.t = 14 * FRAME + 2;
    screen.frame(6 * FRAME); // arrives 8 frames late
    expect(frames.frameTimestamp).toBeCloseTo(14 * FRAME);
    clock.t = 20 * FRAME + 1;
    screen.frame(20 * FRAME);
    expect(ends).toHaveLength(1);
    expect(ends[0][1] - ends[0][0]).toBeCloseTo(6 * FRAME);
  });
});

describe('framesFor and next', () => {
  it('rounds a duration to whole frames, never below one, and follows setFrameMs', () => {
    const { frames } = setup();
    expect(frames.framesFor(100)).toBe(6);
    expect(frames.framesFor(200)).toBe(12);
    expect(frames.framesFor(1)).toBe(1);
    frames.setFrameMs(1000 / 144);
    expect(frames.framesFor(100)).toBe(14);
  });

  it('next resolves with the next frame timestamp', async () => {
    const { screen, frames } = setup();
    const promise = frames.next();
    screen.frame(123.4);
    expect(await promise).toBe(123.4);
  });
});
