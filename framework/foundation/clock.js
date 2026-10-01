// One monotonic clock for the whole page. `t` is milliseconds since the page's time
// origin (performance.now()); the wall-clock anchor lets analysis map t to real time.

const DURATION = /^(\d+(?:\.\d+)?)\s?(ms|s)$/;

/**
 * @param {{now?: () => number, timeOrigin?: number, wallNow?: () => number, timezone?: string}} [source]
 *   injectable for tests; defaults to performance and Date
 */
export function createClock(source = {}) {
  const now = source.now ?? (() => performance.now());
  const wallNow = source.wallNow ?? (() => Date.now());
  const timeOrigin = source.timeOrigin ?? performance.timeOrigin ?? wallNow() - now();

  return {
    now,
    /** Wall-clock milliseconds for a page time: wall = time_origin_ms + t. */
    toWall: (t) => timeOrigin + t,
    /** The record written as `session.clock_anchor` and into the session record. */
    anchor() {
      const wall = new Date(timeOrigin + now());
      return {
        time_origin_ms: timeOrigin,
        wall_iso: wall.toISOString(),
        timezone: source.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        utc_offset_min: -wall.getTimezoneOffset(),
      };
    },
  };
}

/** Resolves with the timestamp of the next animation frame (the rAF callback argument). */
export function nextFrame(raf = globalThis.requestAnimationFrame) {
  return new Promise((resolve) => raf(resolve));
}

/**
 * Milliseconds from a duration value: a number, '1.5s' / '200ms', or {frames}.
 * Frames need the display's frame time, so `frameMs` must be given for them.
 */
export function durationMs(value, frameMs) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = DURATION.exec(value);
    if (!match) throw new TypeError(`invalid duration "${value}"`);
    return Number(match[1]) * (match[2] === 's' ? 1000 : 1);
  }
  if (value && typeof value === 'object' && Number.isInteger(value.frames)) {
    if (frameMs === undefined) throw new TypeError('a frame duration needs the frame time (frameMs)');
    return value.frames * frameMs;
  }
  throw new TypeError(`invalid duration ${JSON.stringify(value)}`);
}
