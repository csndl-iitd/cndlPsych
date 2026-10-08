// Eye tracking: WebGazer behind a small engine interface, plus everything that turns its
// predictions into bus events (chunked `gaze.samples`, `gaze.lost` / `gaze.regained`, the
// derived `input.gaze.dwell`) and the calibration / validation procedures. This is the only
// module that may import WebGazer, and only lazily: a session without eye tracking never
// loads it (hard rule 2).
//
// The screens (the dots) belong to the runtime; this module asks for them through `present`.
// Calibration is by fixation, not by clicking: the participant looks at a dot, and the dot's
// position is given to WebGazer as the truth for what the eyes are doing then.
import { schedule as defaultSchedule } from '../foundation/clock.js';
import { calibrationPoints, createDwell, createPresence, createThrottle, validationPoints, validationStats } from './gaze-math.js';

const DEFAULTS = {
  sample_hz: 30,
  calibration: { points: 9, repeats: 2 },
  validation: { points: 5, max_error_px: 150, max_retries: 3, on_fail: 'retry' },
  revalidate: {},
  dwell: { radius: '80px', min_ms: 100 },
  learn_from_clicks: false,
  camera: { preview: 'setup_only', on_denied: 'abort' },
};
const withDefaults = (config) => Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, typeof value === 'object' ? { ...value, ...config[key] } : config[key] ?? value]));

const MAX_ROWS = 200; // ~6 kB per gaze.samples event, far below the Firestore chunk limit
const FLUSH_MS = 1000;
const LOST_MS = 500;
const SETTLE_MS = 700; // time for the eyes to arrive at a new dot
const CALIBRATION_MS = 900;
const CALIBRATION_STEP_MS = 100;
const VALIDATION_MS = 1000;

const round = (value, digits) => Number(value.toFixed(digits));

/** Load WebGazer and wrap it. `solutionPath` is where its face model files are served from (by default next to this script, in mediapipe/face_mesh). */
export async function loadWebgazer({ solutionPath = new URL('mediapipe/face_mesh', import.meta.url).href } = {}) {
  const [{ default: webgazer }, manifest] = await Promise.all([import('webgazer'), import('webgazer/package.json')]);
  webgazer.params.faceMeshSolutionPath = solutionPath;
  return {
    version: (manifest.default ?? manifest).version,
    async begin({ onSample, learnFromClicks }) {
      webgazer.saveDataAcrossSessions(false); // nothing is kept in the browser between sessions
      webgazer.setGazeListener((data) => onSample(data ? { x: data.x, y: data.y } : null));
      await webgazer.begin();
      if (!learnFromClicks) webgazer.removeMouseEventListeners();
      webgazer.showPredictionPoints(false).showFaceOverlay(false).showFaceFeedbackBox(false);
    },
    record: (cx, cy) => webgazer.recordScreenPosition(cx, cy, 'click'),
    preview: (show) => webgazer.showVideoPreview(show),
    end() {
      webgazer.clearGazeListener();
      try {
        webgazer.stopVideo(); // releases the camera
      } catch { /* the overlays may already be gone */ }
      webgazer.end();
    },
  };
}

const DENIED = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError']);
const MISSING = new Set(['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']);
const failureReason = (error) => (DENIED.has(error?.name) ? 'denied' : MISSING.has(error?.name) ? 'no_camera' : 'error');

/**
 * @param {{
 *   bus: object, clock: object, stage: object, config: object, rng: object,
 *   loadEngine?: Function, schedule?: Function, scale?: (ms: number) => number,
 * }} options `config` is `eyetracking` from experiment.yaml; `scale` shortens waits when debug.time_scale is set
 */
export function createGaze({ bus, clock, stage, config, rng, loadEngine = loadWebgazer, schedule = defaultSchedule, scale = (ms) => ms }) {
  const settings = withDefaults(config);
  const wait = (ms) => new Promise((resolve) => { schedule(scale(ms), resolve); });
  const presence = createPresence({ lostMs: LOST_MS });
  const throttle = createThrottle(settings.sample_hz);
  const validations = [];
  let engine = null;
  let engineVersion = null; // kept after stop(), for the record
  let dwell = null;
  let recording = false;
  let collector = null;
  let rows = [];
  let cancelFlush = null;
  let cameraDenied = false;
  let present = async () => {};

  const client = (point) => {
    const { x, y, w, h } = stage.rect;
    return { cx: x + point.x * w, cy: y + point.y * h };
  };

  function flush() {
    cancelFlush?.();
    cancelFlush = null;
    if (!rows.length) return;
    bus.emit({ source: 'gaze', type: 'gaze.samples', data: { samples: rows, nominal_hz: settings.sample_hz } });
    rows = [];
  }

  function addRow(t, cx, cy) {
    const { x, y } = stage.toStage(cx, cy);
    rows.push([round(t, 1), round(x, 4), round(y, 4)]);
    if (rows.length >= MAX_ROWS) flush();
    else cancelFlush ??= schedule(FLUSH_MS, () => { cancelFlush = null; flush(); });
  }

  function emitDwell(found) {
    const { cx, cy } = found;
    const point = stage.toStage(cx, cy);
    const hit = stage.hit(cx, cy);
    bus.emit({
      source: 'gaze',
      type: 'input.gaze.dwell',
      t: found.t_end,
      data: { t_start: found.t_start, t_end: found.t_end, duration_ms: found.duration_ms, x: round(point.x, 4), y: round(point.y, 4), radius: stage.lengthToPx(settings.dwell.radius), target: hit?.ref ?? null },
    });
  }

  function onSample(prediction) {
    const t = clock.now();
    if (prediction) collector?.push({ cx: prediction.x, cy: prediction.y });
    if (!recording) return;
    const change = presence.feed(t, prediction !== null);
    if (change) bus.emit({ source: 'gaze', type: `gaze.${change}`, data: {}, t });
    if (!prediction) return;
    const found = dwell({ t, cx: prediction.x, cy: prediction.y });
    if (found && bus.context.block) emitDwell(found);
    if (throttle(t)) addRow(t, prediction.x, prediction.y);
  }

  /** Look at `trials`' dots in turn: show each (`present` resolves once it is up), then collect. */
  async function visit(points, phase, collect) {
    const results = [];
    for (const [index, point] of points.entries()) {
      const where = client(point);
      await present({ ...point, index, total: points.length, phase });
      results.push(await collect(where));
    }
    return results;
  }
  return {
    /**
     * Load the engine and open the camera.
     * @returns {Promise<{ok: true, version: string}|{ok: false, reason: 'denied'|'no_camera'|'error', message: string}>}
     */
    async start() {
      try {
        engine = await loadEngine();
        dwell = createDwell({ radiusPx: stage.lengthToPx(settings.dwell.radius), minMs: settings.dwell.min_ms });
        await engine.begin({ onSample, learnFromClicks: settings.learn_from_clicks });
        engineVersion = engine.version;
        return { ok: true, version: engine.version };
      } catch (error) {
        engine = null; // never started: nothing to end later
        cameraDenied = failureReason(error) === 'denied';
        return { ok: false, reason: failureReason(error), message: String(error?.message ?? error) };
      }
    },

    setPreview: (show) => engine?.preview(show),

    /** @param {{present: (dot: object) => Promise<void>}} screens */
    async calibrate({ present: show }) {
      present = show;
      const { points, repeats } = settings.calibration;
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        await visit(calibrationPoints(points, rng.fork(`gaze-calibration:${repeat}`)), 'calibration', async ({ cx, cy }) => {
          await wait(SETTLE_MS);
          for (let spent = 0; spent < CALIBRATION_MS; spent += CALIBRATION_STEP_MS) {
            engine.record(cx, cy);
            await wait(CALIBRATION_STEP_MS);
          }
        });
      }
      bus.emit({ source: 'gaze', type: 'gaze.calibration', data: { points, repeats, completed: true } });
    },

    /**
     * Measure the error on fresh points; logged as `gaze.validation` and kept for the session record.
     * @returns {Promise<{attempt: number, points: number, mean_error_px: number, precision_px: number, passed: boolean}>}
     */
    async validate({ present: show, atTrial }) {
      present = show;
      const trials = await visit(validationPoints(settings.validation.points), 'validation', async (target) => {
        await wait(SETTLE_MS);
        collector = [];
        await wait(VALIDATION_MS);
        const samples = collector;
        collector = null;
        return { target, samples };
      });
      const { w, h } = stage.rect;
      const stats = validationStats(trials, Math.hypot(w, h));
      const attempt = validations.length + 1;
      const passed = stats.enough && stats.mean_error_px <= settings.validation.max_error_px;
      const result = { attempt, points: stats.points, mean_error_px: round(stats.mean_error_px, 1), precision_px: round(stats.precision_px, 1), passed };
      bus.emit({ source: 'gaze', type: 'gaze.validation', data: { ...result, max_error_px: settings.validation.max_error_px } });
      validations.push({ attempt, mean_error_px: result.mean_error_px, passed, ...(atTrial === undefined ? {} : { at_trial: atTrial }) });
      return result;
    },

    /** Start or stop writing predictions to the log (not during setup). */
    setRecording(on) {
      if (!on) flush();
      recording = on;
    },

    flush,

    /** The `eyetracking` part of the session record. */
    summary: () => ({
      enabled: true,
      engine: 'webgazer',
      ...(engineVersion ? { engine_version: engineVersion } : {}),
      ...(cameraDenied ? { camera_denied: true } : {}),
      validations: [...validations],
    }),

    async stop() {
      recording = false;
      flush();
      engine?.end();
      engine = null;
    },

    settings,
  };
}
