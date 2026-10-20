// The arithmetic of eye tracking, with no camera and no DOM: calibration and validation
// layouts, how far a prediction is from where the participant was asked to look, and the
// small state machines for dwell and for losing / regaining the face. Positions are stage
// coordinates (0-1 across the stage) unless a name ends in `px` / `cx` / `cy` (client pixels).

const CALIBRATION_LAYOUTS = {
  5: [[0.1, 0.1], [0.9, 0.1], [0.5, 0.5], [0.1, 0.9], [0.9, 0.9]],
  9: [[0.1, 0.1], [0.5, 0.1], [0.9, 0.1], [0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.1, 0.9], [0.5, 0.9], [0.9, 0.9]],
  13: [[0.1, 0.1], [0.5, 0.1], [0.9, 0.1], [0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.1, 0.9], [0.5, 0.9], [0.9, 0.9], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]],
};
// Validation points sit between the calibration points, so the model is tested where it was not trained.
const VALIDATION_LAYOUT = [[0.5, 0.3], [0.3, 0.5], [0.7, 0.5], [0.5, 0.7], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]];

export const MAX_VALIDATION_POINTS = VALIDATION_LAYOUT.length;
const toPoint = ([x, y]) => ({ x, y });

/** The calibration targets, in a seeded random order so the participant cannot anticipate the next one. */
export function calibrationPoints(count, rng) {
  const layout = CALIBRATION_LAYOUTS[count];
  if (!layout) throw new RangeError(`calibration has 5, 9 or 13 points, not ${count}`);
  return rng.shuffle(layout.map(toPoint));
}

export function validationPoints(count) {
  return VALIDATION_LAYOUT.slice(0, Math.min(count, MAX_VALIDATION_POINTS)).map(toPoint);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Minimum predictions at one validation point for it to count. */
export const MIN_SAMPLES = 3;

/**
 * How well predictions match the targets, in px. For each target: accuracy is the distance
 * from the target to the median prediction; precision is the RMS distance of the predictions
 * from their own mean (their scatter). A target with fewer than MIN_SAMPLES predictions is not
 * counted; fewer than half the targets with data means the validation fails, with the error
 * reported as `fallbackPx` (the worst case, the stage diagonal) rather than guessed.
 * @param {{target: {cx: number, cy: number}, samples: {cx: number, cy: number}[]}[]} trials
 * @returns {{points: number, mean_error_px: number, precision_px: number, enough: boolean}}
 */
export function validationStats(trials, fallbackPx) {
  const usable = trials.filter(({ samples }) => samples.length >= MIN_SAMPLES);
  if (usable.length * 2 < trials.length || !usable.length) {
    return { points: usable.length, mean_error_px: fallbackPx, precision_px: fallbackPx, enough: false };
  }
  const errors = usable.map(({ target, samples }) => Math.hypot(median(samples.map((s) => s.cx)) - target.cx, median(samples.map((s) => s.cy)) - target.cy));
  const scatters = usable.map(({ samples }) => {
    const mx = samples.reduce((sum, s) => sum + s.cx, 0) / samples.length;
    const my = samples.reduce((sum, s) => sum + s.cy, 0) / samples.length;
    return Math.sqrt(samples.reduce((sum, s) => sum + (s.cx - mx) ** 2 + (s.cy - my) ** 2, 0) / samples.length);
  });
  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
  return { points: usable.length, mean_error_px: mean(errors), precision_px: mean(scatters), enough: true };
}

/** Accept a prediction only if enough time has passed since the last accepted one (the engine runs faster than `sample_hz`). */
export function createThrottle(hz) {
  const interval = 1000 / hz;
  let last = -Infinity;
  return (t) => {
    if (t - last < interval * 0.9) return false; // 10% slack: callbacks do not arrive on an exact grid
    last = t;
    return true;
  };
}

/**
 * Fixation detector: the gaze stays within `radiusPx` of where the fixation began for `minMs`.
 * `feed` returns the dwell once, when the time is reached, and nothing more until gaze leaves.
 * @returns {(point: {t: number, cx: number, cy: number}) => ({t_start: number, t_end: number, duration_ms: number, cx: number, cy: number}|null)}
 */
export function createDwell({ radiusPx, minMs }) {
  let anchor = null;
  let fired = false;
  let points = [];
  return ({ t, cx, cy }) => {
    if (!anchor || Math.hypot(cx - anchor.cx, cy - anchor.cy) > radiusPx) {
      anchor = { t, cx, cy };
      points = [];
      fired = false;
    }
    points.push({ cx, cy });
    if (fired || t - anchor.t < minMs) return null;
    fired = true;
    const centre = { cx: points.reduce((s, p) => s + p.cx, 0) / points.length, cy: points.reduce((s, p) => s + p.cy, 0) / points.length };
    return { t_start: anchor.t, t_end: t, duration_ms: t - anchor.t, ...centre };
  };
}

/**
 * Face presence: `lost` once no prediction has arrived for `lostMs`, `regained` on the next one.
 * `feed(t, present)` is called for every engine callback; `tick(t)` may be called without a callback
 * (an engine that stops calling back when it loses the face).
 */
export function createPresence({ lostMs }) {
  let lastSeen = null;
  let lost = false;
  const check = (t) => {
    if (lost || lastSeen === null || t - lastSeen < lostMs) return null;
    lost = true;
    return 'lost';
  };
  return {
    feed(t, present) {
      if (present) {
        lastSeen = t;
        if (!lost) return null;
        lost = false;
        return 'regained';
      }
      lastSeen ??= t;
      return check(t);
    },
    tick: check,
    get lost() { return lost; },
  };
}
