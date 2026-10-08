import { describe, expect, it } from 'vitest';
import { createBus } from '../foundation/events.js';
import { createRng } from '../foundation/rng.js';
import { makeChunks } from '../storage/chunks.js';
import { createGaze } from './gaze.js';

/** A fake clock the test advances; schedule() runs callbacks when time passes. */
function world() {
  let now = 0;
  const timers = [];
  return {
    clock: { now: () => now },
    schedule(ms, fn) {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
    /** Move time forward, firing due timers in order. */
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await new Promise((resolve) => { setImmediate(resolve); }); // let awaiting code schedule its next wait
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > end) break;
        const timer = timers.shift();
        now = timer.at;
        timer.fn();
      }
      now = end;
    },
    set: (t) => { now = t; },
  };
}

const RECT = { x: 100, y: 50, w: 800, h: 600 };
const stage = {
  get rect() { return RECT; },
  toStage: (cx, cy) => ({ x: (cx - RECT.x) / RECT.w, y: (cy - RECT.y) / RECT.h }),
  hit: (cx) => (cx > 800 ? { ref: { id: 7, role: 'target' } } : null),
  lengthToPx: (length) => Number.parseFloat(length),
};

function fakeEngine({ fail } = {}) {
  const engine = {
    version: '9.9.9', recorded: [], previews: [], ended: false, onSample: null,
    async begin({ onSample, learnFromClicks }) {
      if (fail) throw Object.assign(new Error('nope'), { name: fail });
      engine.onSample = onSample;
      engine.learnFromClicks = learnFromClicks;
    },
    record: (cx, cy) => engine.recorded.push([cx, cy]),
    preview: (show) => engine.previews.push(show),
    end() { engine.ended = true; },
  };
  return engine;
}

function setup({ config = {}, engine = fakeEngine() } = {}) {
  const w = world();
  const bus = createBus({ clock: w.clock });
  const events = [];
  bus.on('*', (event) => events.push(event));
  const gaze = createGaze({ bus, clock: w.clock, stage, config: { enabled: true, ...config }, rng: createRng(5), loadEngine: async () => engine, schedule: w.schedule });
  return { w, bus, events, gaze, engine };
}
const ofType = (events, type) => events.filter((e) => e.type === type);

describe('start', () => {
  it('loads the engine and reports its version; clicks do not train it unless asked', async () => {
    const { gaze, engine } = setup();
    expect(await gaze.start()).toEqual({ ok: true, version: '9.9.9' });
    expect(engine.learnFromClicks).toBe(false);
    expect(gaze.summary()).toEqual({ enabled: true, engine: 'webgazer', engine_version: '9.9.9', validations: [] });
  });

  it('passes learn_from_clicks on', async () => {
    const { gaze, engine } = setup({ config: { learn_from_clicks: true } });
    await gaze.start();
    expect(engine.learnFromClicks).toBe(true);
  });

  it.each([['NotAllowedError', 'denied'], ['NotFoundError', 'no_camera'], ['SomethingElse', 'error']])('a camera failure (%s) is reported as %s, not thrown', async (name, reason) => {
    const { gaze } = setup({ engine: fakeEngine({ fail: name }) });
    expect(await gaze.start()).toMatchObject({ ok: false, reason, message: 'nope' });
    expect(gaze.summary().camera_denied).toBe(reason === 'denied' ? true : undefined);
    expect(gaze.summary().engine_version).toBeUndefined(); // it never ran
    await gaze.stop(); // must not try to end an engine that never began
  });
});

describe('samples', () => {
  async function started(config) {
    const s = setup({ config });
    await s.gaze.start();
    s.gaze.setRecording(true);
    return s;
  }

  it('records nothing until recording is switched on', async () => {
    const s = setup();
    await s.gaze.start();
    s.engine.onSample({ x: 300, y: 200 });
    s.gaze.flush();
    expect(ofType(s.events, 'gaze.samples')).toEqual([]);
  });

  it('writes stage coordinates at about sample_hz, in chunks that flush on a timer and at the end', async () => {
    const s = await started({ sample_hz: 10 });
    for (let t = 0; t < 2500; t += 10) {
      s.w.set(t);
      s.engine.onSample({ x: 500, y: 350 });
      await s.w.advance(0);
    }
    await s.w.advance(1500);
    const chunks = ofType(s.events, 'gaze.samples');
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const rows = chunks.flatMap((c) => c.data.samples);
    expect(rows.length).toBeGreaterThanOrEqual(23);
    expect(rows.length).toBeLessThanOrEqual(28);
    expect(rows[0]).toEqual([0, 0.5, 0.5]);
    expect(chunks[0].data.nominal_hz).toBe(10);
    s.gaze.setRecording(false);
  });

  it('cuts a chunk at 200 rows so an event stays small', async () => {
    const s = await started({ sample_hz: 120 });
    for (let t = 0; t < 4000; t += 8) {
      s.w.set(t);
      s.engine.onSample({ x: 500, y: 350 });
    }
    const first = ofType(s.events, 'gaze.samples')[0];
    expect(first.data.samples).toHaveLength(200);
    expect(JSON.stringify(first.data).length).toBeLessThan(10_000);
  });

  it('a full chunk of the widest rows still fits the smallest storage chunk limit (storage.firebase.chunk.max_bytes 10000)', async () => {
    const s = await started({ sample_hz: 120 });
    for (let i = 0; i < 200; i += 1) {
      s.w.set(9_999_999 + i * 10 + 0.123456);
      s.engine.onSample({ x: 100 + 800 * 0.98765432, y: 50 + 600 * 0.87654321 });
    }
    const [event] = ofType(s.events, 'gaze.samples');
    expect(event.data.samples).toHaveLength(200);
    expect(await makeChunks([event], { maxBytes: 10_000 })).toHaveLength(1);
  });

  it('flushes what is left when recording stops or the engine is stopped', async () => {
    const s = await started({});
    s.engine.onSample({ x: 500, y: 350 });
    await s.gaze.stop();
    expect(ofType(s.events, 'gaze.samples')).toHaveLength(1);
    expect(s.engine.ended).toBe(true);
  });

  it('logs gaze.lost after half a second without a face and gaze.regained when it returns', async () => {
    const s = await started({});
    s.w.set(0); s.engine.onSample({ x: 500, y: 350 });
    s.w.set(300); s.engine.onSample(null);
    s.w.set(700); s.engine.onSample(null);
    s.w.set(900); s.engine.onSample({ x: 500, y: 350 });
    expect(s.events.map((e) => e.type).filter((t) => t.startsWith('gaze.') && t !== 'gaze.samples')).toEqual(['gaze.lost', 'gaze.regained']);
  });

  it('derives input.gaze.dwell with the target under the gaze, only inside a block', async () => {
    const s = await started({ dwell: { radius: '30px', min_ms: 100 } });
    const stare = (from, cx) => { for (let t = from; t <= from + 120; t += 20) { s.w.set(t); s.engine.onSample({ x: cx, y: 300 }); } };
    stare(0, 600); // before any block: no dwell event
    expect(ofType(s.events, 'input.gaze.dwell')).toEqual([]);
    s.bus.setContext({ block: 'b', trial: 1, phase: 'p' });
    stare(1000, 850);
    stare(2000, 300);
    const [onTarget, offTarget] = ofType(s.events, 'input.gaze.dwell');
    expect(onTarget.data).toMatchObject({ t_start: 1000, duration_ms: 100, radius: 30, target: { id: 7, role: 'target' } });
    expect(onTarget.data.x).toBeCloseTo(0.9375, 3);
    expect(offTarget.data.target).toBeNull();
  });
});

describe('calibration and validation', () => {
  /** Dots that are "up" immediately; the test decides where the participant looks. */
  const dots = (log = []) => ({ present: async (dot) => { log.push(dot); } });

  it('shows every point `repeats` times and teaches the engine each dot position', async () => {
    const s = setup({ config: { calibration: { points: 5, repeats: 2 } } });
    await s.gaze.start();
    const log = [];
    const done = s.gaze.calibrate(dots(log));
    await s.w.advance(60_000);
    await done;
    expect(log).toHaveLength(10);
    expect(log.every((d) => d.phase === 'calibration' && d.total === 5)).toBe(true);
    expect(new Set(s.engine.recorded.map(([cx, cy]) => `${cx},${cy}`)).size).toBe(5);
    expect(s.engine.recorded.length).toBe(10 * 9);
    expect(ofType(s.events, 'gaze.calibration')[0].data).toEqual({ points: 5, repeats: 2, completed: true });
  });

  async function validateWith(predict, config = {}) {
    const s = setup({ config: { validation: { points: 3, max_error_px: 100, ...config } } });
    await s.gaze.start();
    let dot = null;
    const timer = (async () => {
      for (let i = 0; i < 400; i += 1) {
        await s.w.advance(100);
        if (dot) s.engine.onSample(predict(dot));
      }
    })();
    const result = await s.gaze.validate({ present: async (d) => { dot = { cx: RECT.x + d.x * RECT.w, cy: RECT.y + d.y * RECT.h }; }, atTrial: 12 });
    await timer;
    return { s, result };
  }

  it('passes when predictions are close, and logs the attempt with the threshold', async () => {
    const { s, result } = await validateWith((dot) => ({ x: dot.cx + 20, y: dot.cy }));
    expect(result).toMatchObject({ attempt: 1, points: 3, mean_error_px: 20, passed: true });
    expect(ofType(s.events, 'gaze.validation')[0].data).toMatchObject({ attempt: 1, passed: true, max_error_px: 100 });
    expect(s.gaze.summary().validations).toEqual([{ attempt: 1, mean_error_px: 20, passed: true, at_trial: 12 }]);
  });

  it('fails when predictions are far off', async () => {
    const { result } = await validateWith((dot) => ({ x: dot.cx + 300, y: dot.cy }));
    expect(result).toMatchObject({ passed: false });
    expect(result.mean_error_px).toBeCloseTo(300, 0);
  });

  it('fails, with the worst case reported and not a guess, when no face was seen', async () => {
    const { result } = await validateWith(() => null);
    expect(result).toMatchObject({ points: 0, passed: false, mean_error_px: Math.round(Math.hypot(RECT.w, RECT.h) * 10) / 10 });
  });

  it('numbers attempts across repeated validations', async () => {
    const { s } = await validateWith((dot) => ({ x: dot.cx, y: dot.cy }));
    expect(s.gaze.summary().validations.map((v) => v.attempt)).toEqual([1]);
  });
});
