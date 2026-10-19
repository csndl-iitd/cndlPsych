// Eye tracking in the session (ARCHITECTURE.md section 8): ask for the camera, calibrate and
// validate, decide what a failed validation means, record from then on, and validate again at
// block boundaries when `eyetracking.revalidate` asks for it. The mechanics are in
// pipeline/gaze.js; this wires them to the screens and the session.
import { askAction } from '../authoring/modules/survey.js';
import { createGaze } from '../pipeline/gaze.js';

const DOT_SIZE_PX = 28;

/** Does eye tracking run for this device profile? */
export const eyetrackingApplies = (plan, profile) => plan.eyetracking?.enabled === true && (plan.eyetracking.profiles ?? ['desktop']).includes(profile);

/** The calibration dot, drawn on the stage; `present` is what pipeline/gaze.js calls for each point. */
function createDots(stage, ownerDocument) {
  let dot = null;
  return {
    async present({ x, y }) {
      if (!dot) {
        dot = ownerDocument.createElement('div');
        Object.assign(dot.style, {
          position: 'absolute', width: `${DOT_SIZE_PX}px`, height: `${DOT_SIZE_PX}px`, marginLeft: `-${DOT_SIZE_PX / 2}px`, marginTop: `-${DOT_SIZE_PX / 2}px`,
          borderRadius: '50%', background: '#e33', border: '3px solid #fff', boxShadow: '0 0 0 2px #333', pointerEvents: 'none', zIndex: '1000',
        });
        dot.className = 'expfw-gaze-dot';
        stage.element.append(dot);
      }
      Object.assign(dot.style, { left: `${x * 100}%`, top: `${y * 100}%` });
    },
    clear() {
      dot?.remove();
      dot = null;
    },
  };
}

const intro = (recording) => `## Eye tracking

This experiment uses your camera to estimate where you are looking.${recording ? '' : ' **No video is recorded or stored.**'}

Sit centred in front of the screen with your face well lit, and keep your head as still as you can. Choose *Start*, then allow the camera when your browser asks.`;
const CALIBRATE = `## Calibration

Look at each red dot until it moves. Keep your head still.`;
const failed = (validation, limit) => `## Eye tracking was not accurate enough

The average error was about **${Math.round(validation.mean_error_px)} px** (needed ${limit} px or less). Check your lighting and sit still, then try again.`;

/**
 * Set up eye tracking for a session.
 * @param {{services: object, screen: object, plan: object, profile: string, rng: object, loadEngine?: Function}} options
 *   `rng` is the session's seeded generator (calibration order is reproducible)
 * @returns {Promise<{status: 'off'|'ready'|'continue_without'|'aborted', reason?: string, summary: () => (object|undefined), beforeBlock: (block: object) => Promise<boolean>, stop: () => Promise<void>}>}
 *   `beforeBlock` returns false when the session must stop (a failed re-validation); `stop` releases the camera
 */
export async function setupEyeTracking({ services, screen, plan, profile, rng, loadEngine }) {
  const nothing = { status: 'off', summary: () => undefined, beforeBlock: async () => true, stop: async () => {} };
  if (!plan.eyetracking?.enabled) return nothing;
  if (!eyetrackingApplies(plan, profile)) return { ...nothing, summary: () => ({ enabled: false }) };

  const { bus, clock, stage, display } = services;
  const gaze = createGaze({ bus, clock, stage, config: plan.eyetracking, rng: rng.fork('gaze'), scale: services.scale, ...(loadEngine ? { loadEngine } : {}) });
  const { validation, camera, revalidate } = gaze.settings;
  const dots = createDots(stage, display.ownerDocument);
  services.input.onLeave(() => gaze.flush());
  const counters = { trials: 0, validatedAt: clock.now(), trialsAtValidation: 0 };
  bus.on('trial.end', () => { counters.trials += 1; });
  const result = (status, extra = {}) => ({ status, summary: gaze.summary, beforeBlock, stop: () => gaze.stop(), ...extra });

  /** Calibrate (unless only re-validating) and validate; retry as `on_fail` says. Resolves to whether the session may go on. */
  async function procedure({ calibrate }) {
    gaze.setRecording(false);
    const retries = validation.on_fail === 'abort' ? 0 : validation.max_retries;
    let needsCalibration = calibrate;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (needsCalibration) {
        await askAction(screen, { message: CALIBRATE, choices: [{ value: 'go', text: 'Start' }], submitLabel: 'Continue' });
        await gaze.calibrate(dots);
      }
      const verdict = await gaze.validate({ ...dots, atTrial: counters.trials });
      dots.clear();
      counters.validatedAt = clock.now();
      counters.trialsAtValidation = counters.trials;
      if (verdict.passed) return true;
      needsCalibration = true;
      if (attempt < retries) await askAction(screen, { message: failed(verdict, validation.max_error_px), choices: [{ value: 'retry', text: 'Try again' }], submitLabel: 'Continue' });
    }
    return validation.on_fail === 'continue_flagged';
  }

  function due() {
    const sinceTrials = counters.trials - counters.trialsAtValidation;
    const sinceMinutes = (clock.now() - counters.validatedAt) / 60_000;
    return (revalidate.every_trials !== undefined && sinceTrials >= revalidate.every_trials) || (revalidate.every_minutes !== undefined && sinceMinutes >= revalidate.every_minutes);
  }

  async function beforeBlock() {
    if (!due()) return true;
    if (camera.preview !== 'never') gaze.setPreview(true);
    const ok = await procedure({ calibrate: false });
    gaze.setPreview(camera.preview === 'always');
    gaze.setRecording(true);
    return ok;
  }

  await askAction(screen, { message: intro(plan.webcam?.enabled === true), choices: [{ value: 'start', text: 'Start' }], submitLabel: 'Continue' });
  const started = await gaze.start();
  if (!started.ok) {
    if (started.reason === 'no_addon') {
      bus.emit({ source: 'system', type: 'system.error', data: { code: 'eyetracking_addon_missing', message: started.message, fatal: true } });
      return result('aborted', { reason: 'no_addon' });
    }
    bus.emit({ source: 'system', type: 'system.warning', data: { code: 'camera_unavailable', message: `the camera could not be used: ${started.message}`, detail: { reason: started.reason } } });
    return camera.on_denied === 'continue_without' ? result('continue_without', { reason: started.reason }) : result('aborted', { reason: started.reason });
  }
  gaze.setPreview(camera.preview !== 'never');
  const ok = await procedure({ calibrate: true });
  gaze.setPreview(camera.preview === 'always');
  if (!ok) return result('aborted', { reason: 'validation_failed' });
  gaze.setRecording(true);
  return result('ready');
}
