// Gesture recognizer: tap, longpress, swipe and drag from normalised pointer samples.
// Pure state machine: time, geometry, hit testing and emitting are all injected, so it
// is tested without a browser. One pointer at a time; a second pointer is ignored.
//
// Only the enabled gestures run (fewer gestures means less ambiguity and latency).
// When both `drag` and `swipe` are enabled, drag wins and no swipe is reported.
import { durationMs, schedule as defaultSchedule } from '../foundation/clock.js';

const REASONS = ['pointer_cancel', 'phase_end', 'blur', 'other'];
const PATH_CHUNK_ROWS = 256;
const MULTI_TAP_WINDOW_MS = 400;
const MULTI_TAP_RADIUS_PX = 40;

/** Thresholds used when the scope sets none (lengths in px, velocity in stage lengths / s). */
export const DEFAULT_THRESHOLDS = {
  tap: { max_duration: 500, slop: '10px' },
  longpress: { min_duration: 500, slop: '10px' },
  swipe: { min_distance: '40px', min_velocity: 0.2, max_duration: 1000 },
  drag: { slop: '10px' },
};

const dist = (a, b) => Math.hypot(b.cx - a.cx, b.cy - a.cy);
const point = ({ x, y, cx, cy }) => ({ x, y, cx, cy });
const round = (value) => Math.round(value * 1000) / 1000;

function directionOf(dx, dy) {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

/** Ids 1, 2, 3, ... */
export function createCounter() {
  let last = 0;
  return () => { last += 1; return last; };
}

/**
 * @param {{
 *   emit: (type: string, data: object, t: number) => void,
 *   now: () => number,
 *   hit: (cx: number, cy: number, padding: number) => {ref: object, box: DOMRect}|null,
 *   toPx: (length: number|string) => number,
 *   shorterSide: () => number,
 *   schedule?: Function,
 *   nextId?: () => number,
 * }} deps `nextId` hands out gesture ids; recognizers that share one keep their ids distinct
 */
export function createRecognizer({ emit, now, hit, toPx, shorterSide, schedule = defaultSchedule, nextId = createCounter() }) {
  let config = { gestures: new Set(), thresholds: DEFAULT_THRESHOLDS, fireOn: 'up', path: false, padding: 0 };
  let active = null;
  let lastTap = null;

  const enabled = (name) => config.gestures.has(name);
  const threshold = (gesture, key) => config.thresholds[gesture][key];
  const px = (gesture, key) => toPx(threshold(gesture, key));
  const ms = (gesture, key) => durationMs(threshold(gesture, key));

  function hitAt(sample) {
    return hit(sample.cx, sample.cy, config.padding);
  }

  function targetField(found) {
    return { target: found ? found.ref : null };
  }

  // ---- paths ------------------------------------------------------------------
  function recordSample(g, sample) {
    if (!config.path) return;
    const interval = config.path.hz ? 1000 / config.path.hz : 0;
    const last = g.samples.at(-1);
    if (last && sample.t - last[0] < interval) return;
    g.samples.push([round(sample.t), round(sample.x), round(sample.y), ...(sample.pressure === undefined ? [] : [round(sample.pressure)])]);
  }

  function flushPath(g) {
    if (!config.path || g.samples.length === 0) return;
    for (let i = 0; i < g.samples.length; i += PATH_CHUNK_ROWS) {
      emit('input.pointer.path', { gesture_id: g.id, samples: g.samples.slice(i, i + PATH_CHUNK_ROWS) }, g.samples[i][0]);
    }
  }

  // ---- gesture events -----------------------------------------------------------
  function emitTap(g, up, { atDown }) {
    const downPt = point(g.down);
    const previous = lastTap && g.down.t - lastTap.t_up <= MULTI_TAP_WINDOW_MS && dist(g.down, lastTap.down) <= MULTI_TAP_RADIUS_PX ? lastTap : null;
    const data = {
      gesture_id: g.id,
      pointer_type: g.down.pointerType,
      t_down: g.down.t,
      t_up: atDown ? g.down.t : up.t,
      duration_ms: atDown ? 0 : up.t - g.down.t,
      down: downPt,
      up: atDown ? downPt : point(up),
      slop: atDown ? 0 : round(g.maxDistance),
      ...targetField(g.target),
      ...(atDown ? {} : { up_target: (hitAt(up)?.ref ?? null) }),
      tap_index: previous ? previous.tap_index + 1 : 1,
      ...(previous ? { interval_ms: g.down.t - previous.t_up } : {}),
      ...(g.down.pressure === undefined ? {} : { pressure: g.down.pressure }),
      all_trusted: g.trusted,
    };
    lastTap = { t_up: data.t_up, down: g.down, tap_index: data.tap_index };
    emit('input.tap', data, data.t_up);
  }

  function emitSwipe(g, up) {
    const dx = up.cx - g.down.cx;
    const dy = up.cy - g.down.cy;
    const duration = up.t - g.down.t;
    const side = shorterSide();
    const perSecond = (distancePx, ms2) => (ms2 > 0 ? round(distancePx / side / (ms2 / 1000)) : 0);
    const tail = [...g.recent, up];
    const first = tail[0];
    const last = tail.at(-1);
    emit('input.swipe', {
      gesture_id: g.id,
      t_down: g.down.t,
      t_up: up.t,
      duration_ms: duration,
      down: point(g.down),
      up: point(up),
      dx: round(dx),
      dy: round(dy),
      distance: round(Math.hypot(dx, dy)),
      direction_rad: round(Math.atan2(dy, dx)),
      direction: directionOf(dx, dy),
      mean_velocity: perSecond(Math.hypot(dx, dy), duration),
      peak_velocity: round(g.peakVelocity),
      end_velocity: perSecond(dist(first, last), last.t - first.t),
      straightness: g.pathLength === 0 ? 1 : round(Math.min(1, Math.hypot(dx, dy) / g.pathLength)),
      ...targetField(g.target),
      all_trusted: g.trusted,
    }, up.t);
  }

  function emitDragStart(g, sample) {
    const centre = g.target ? { x: (g.target.box.left + g.target.box.right) / 2, y: (g.target.box.top + g.target.box.bottom) / 2 } : null;
    emit('input.drag.start', {
      gesture_id: g.id,
      t_down: g.down.t,
      t_start: sample.t,
      down: point(g.down),
      start: point(sample),
      ...targetField(g.target),
      ...(centre ? { grab_offset: { x: round(g.down.cx - centre.x), y: round(g.down.cy - centre.y) } } : {}),
    }, sample.t);
  }

  function emitDragEnd(g, up) {
    const duration = up.t - g.down.t;
    emit('input.drag.end', {
      gesture_id: g.id,
      duration_ms: duration,
      down: point(g.down),
      up: point(up),
      displacement: round(dist(g.down, up)),
      path_length: round(g.pathLength),
      mean_velocity: duration > 0 ? round(g.pathLength / shorterSide() / (duration / 1000)) : 0,
      ...targetField(g.target),
      drop_target: hitAt(up)?.ref ?? null,
      all_trusted: g.trusted,
    }, up.t);
  }

  // ---- pointer lifecycle ----------------------------------------------------------
  function down(sample) {
    if (active || config.gestures.size === 0) return;
    const g = {
      id: nextId(),
      pointerId: sample.id,
      down: sample,
      target: hitAt(sample),
      trusted: sample.trusted,
      maxDistance: 0,
      pathLength: 0,
      peakVelocity: 0,
      recent: [sample],
      samples: [],
      dragging: false,
      longpressFired: false,
      tapFiredAtDown: false,
      cancelTimer: null,
    };
    active = g;
    recordSample(g, sample);

    if (enabled('longpress')) {
      const wait = ms('longpress', 'min_duration');
      g.cancelTimer = schedule(wait, () => {
        if (active !== g || g.dragging) return;
        g.longpressFired = true;
        emit('input.longpress.start', { gesture_id: g.id, t_down: g.down.t, t_fire: now(), down: point(g.down), ...targetField(g.target), threshold_ms: wait }, now());
      });
    }
    if (enabled('tap') && config.fireOn === 'down') {
      g.tapFiredAtDown = true;
      emitTap(g, sample, { atDown: true });
    }
  }

  function move(sample) {
    const g = active;
    if (!g || g.pointerId !== sample.id) return;
    const previous = g.recent.at(-1);
    g.trusted = g.trusted && sample.trusted;
    g.maxDistance = Math.max(g.maxDistance, dist(g.down, sample));
    g.pathLength += dist(previous, sample);
    if (sample.t > previous.t) g.peakVelocity = Math.max(g.peakVelocity, dist(previous, sample) / shorterSide() / ((sample.t - previous.t) / 1000));
    g.recent = [...g.recent.slice(-3), sample];
    recordSample(g, sample);

    if (g.cancelTimer && g.maxDistance > px('longpress', 'slop')) {
      g.cancelTimer();
      g.cancelTimer = null;
    }
    if (!g.dragging && !g.longpressFired && enabled('drag') && g.maxDistance > px('drag', 'slop')) {
      g.dragging = true;
      g.cancelTimer?.();
      emitDragStart(g, sample);
    }
  }

  function finish(g, up) {
    if (g.dragging) {
      emitDragEnd(g, up);
    } else if (g.longpressFired) {
      emit('input.longpress.end', {
        gesture_id: g.id, duration_ms: up.t - g.down.t, down: point(g.down), up: point(up), slop: round(g.maxDistance),
        ...targetField(g.target), tap_suppressed: enabled('tap'), all_trusted: g.trusted,
      }, up.t);
    } else if (g.tapFiredAtDown) {
      // already reported at pointer down
    } else if (enabled('swipe') && !enabled('drag') && isSwipe(g, up)) {
      emitSwipe(g, up);
    } else if (enabled('tap') && up.t - g.down.t <= ms('tap', 'max_duration') && g.maxDistance <= px('tap', 'slop')) {
      emitTap(g, up, { atDown: false });
    }
    flushPath(g);
  }

  function isSwipe(g, up) {
    const distance = dist(g.down, up);
    const duration = up.t - g.down.t;
    const velocity = duration > 0 ? distance / shorterSide() / (duration / 1000) : Infinity;
    return distance >= px('swipe', 'min_distance') && velocity >= threshold('swipe', 'min_velocity') && duration <= ms('swipe', 'max_duration');
  }

  function up(sample) {
    const g = active;
    if (!g || g.pointerId !== sample.id) return;
    g.trusted = g.trusted && sample.trusted;
    g.maxDistance = Math.max(g.maxDistance, dist(g.down, sample));
    g.pathLength += dist(g.recent.at(-1), sample);
    g.cancelTimer?.();
    active = null;
    recordSample(g, sample);
    finish(g, sample);
  }

  function cancel(reason = 'other') {
    const g = active;
    if (!g) return;
    if (!REASONS.includes(reason)) throw new RangeError(`unknown cancel reason "${reason}"`);
    g.cancelTimer?.();
    active = null;
    if (g.dragging) emit('input.drag.cancel', { gesture_id: g.id, reason }, now());
    flushPath(g);
  }

  const handlers = { down, move, up, cancel: () => cancel('pointer_cancel') };

  return {
    /** Apply the resolved scope: gestures, gesture_thresholds, fire_on, pointer_path, hit_padding (px). */
    configure({ gestures = [], gesture_thresholds: thresholds = {}, fire_on: fireOn = 'up', pointer_path: path = false, hitPaddingPx = 0 } = {}) {
      cancel('phase_end');
      config = {
        gestures: new Set(gestures),
        thresholds: Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([name, defaults]) => [name, { ...defaults, ...thresholds[name] }])),
        fireOn,
        path: path === true ? {} : path || false,
        padding: hitPaddingPx,
      };
    },
    /** @param {{phase: 'down'|'move'|'up'|'cancel', id: number, t: number, cx: number, cy: number, x: number, y: number, pointerType: string, trusted: boolean, pressure?: number}} sample */
    pointer(sample) {
      handlers[sample.phase](sample);
    },
    cancel,
    get active() { return active !== null; },
  };
}
