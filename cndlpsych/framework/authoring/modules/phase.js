// One phase = one jsPsych html-keyboard-response trial (in its own timeline node) that shows a stimulus.
// jsPsych does the display; the duration is counted in display frames (pipeline/frames.js): the
// phase ends inside the animation-frame callback that completes its frames, so the next phase is
// drawn in the same frame. This module stamps phase.onset / phase.offset on the bus with that frame's
// timestamp (or, when the phase starts outside a frame, the next frame's), so the log never depends
// on jsPsych's data.
import htmlKeyboardResponse from '@jspsych/plugin-html-keyboard-response';

/**
 * Services every module receives (built by runtime/services.js).
 * @typedef {object} ModuleContext
 * @property {object} bus
 * @property {{now: () => number}} clock
 * @property {object} rng seeded stream of the current block
 * @property {string} profile active device profile
 * @property {object} jsPsych
 * @property {{Extension: Function, keysFor: (intents: string[]) => string[]}} bridge
 * @property {{setAccepted: (intents: string[]) => void, reset: (level: string) => void}} mapping
 * @property {(scope: object) => void} applyScope apply a resolved input scope (mapping, input, cursor, bridge keys)
 * @property {(byProfile: object) => object} inputScope the scope for this device from `{profile: scope}`: its own profile's plus those of its other input sources
 * @property {(scope: {enabled: boolean, rules: object[]}) => void} applyTriggers apply a resolved trigger scope
 * @property {(name: string, options: object) => {html: string, data: object}} renderStimulus
 * @property {(ms: number, callback: () => void) => () => void} schedule
 * @property {{frameMs: number, frameTimestamp: number|null, framesFor: (ms: number) => number, after: Function, next: () => Promise<number>}} frames frame-locked timing (pipeline/frames.js)
 * @property {(ms: number) => number} scale applies debug.time_scale to a duration
 * @property {number} frameMs
 * @property {object} plan the compiled plan
 */

/**
 * Parameters (the stimulus function, choices) are evaluated by jsPsych before on_start runs.
 * @param {ModuleContext} ctx
 * @param {{
 *   name: string, stimulus?: string | (() => string|undefined), html: () => string, stimulusData?: () => object, durationMs: number|null,
 *   accepted?: string[], endOnResponse?: boolean, skip?: () => boolean,
 *   onStart?: () => void, onOnset?: (t: number) => void, onEnd?: () => void, reason?: () => string,
 * }} spec
 */
export function phaseTrial(ctx, spec) {
  const accepted = spec.accepted ?? [];
  let loadedAt = 0;
  let onsetT = null;
  let plannedFrames = null;
  let cancelEnd = null;
  let finished = false;
  const stimulusName = () => (typeof spec.stimulus === 'function' ? spec.stimulus() : spec.stimulus);

  function emitOnset(t) {
    if (onsetT !== null) return;
    onsetT = t;
    const data = { phase: spec.name, planned_ms: spec.durationMs, t_dom: loadedAt };
    if (spec.durationMs !== null && !finished) {
      plannedFrames = ctx.frames.framesFor(spec.durationMs);
      data.planned_frames = plannedFrames;
    }
    const stimulus = stimulusName();
    if (stimulus) data.stimulus = stimulus;
    const extra = spec.stimulusData?.();
    if (extra && Object.keys(extra).length) data.stimulus_data = extra;
    ctx.bus.emit({ source: 'task', type: 'phase.onset', t, data });
    spec.onOnset?.(t);
    // Aimed at this onset frame, so the phase always gets its full number of frames.
    if (plannedFrames !== null) cancelEnd = ctx.frames.after(t, plannedFrames, () => { if (!finished) ctx.jsPsych.finishTrial(); });
  }

  // conditional_function exists only on timeline nodes in jsPsych, so a phase is a one-trial timeline.
  const trial = {
    type: htmlKeyboardResponse,
    stimulus: spec.html,
    choices: () => {
      if (accepted.includes('any')) return 'ALL_KEYS';
      return accepted.length ? ctx.bridge.keysFor(accepted) : 'NO_KEYS';
    },
    trial_duration: null, // the phase is ended by the frame loop (see emitOnset), not by a timer
    response_ends_trial: Boolean(spec.endOnResponse) && accepted.length > 0,
    extensions: [{ type: ctx.bridge.Extension, params: { accepted } }],

    on_start() {
      loadedAt = 0;
      onsetT = null;
      plannedFrames = null;
      cancelEnd = null;
      finished = false;
      ctx.bus.setContext({ phase: spec.name });
      ctx.mapping.setAccepted(accepted);
      spec.onStart?.();
    },

    on_load() {
      loadedAt = ctx.clock.now();
      for (const audio of document.querySelectorAll('audio[data-volume]')) audio.volume = Number(audio.dataset.volume);
      // Started inside a frame callback (the previous phase ended on a frame): this frame paints it.
      if (ctx.frames.frameTimestamp !== null) emitOnset(ctx.frames.frameTimestamp);
      else ctx.frames.next().then(emitOnset);
    },

    on_finish() {
      const now = ctx.frames.frameTimestamp ?? ctx.clock.now();
      emitOnset(now);
      finished = true;
      cancelEnd?.();
      const data = { phase: spec.name, actual_ms: now - onsetT, reason: spec.reason?.() ?? 'duration' };
      if (plannedFrames !== null) data.frames = Math.round((now - onsetT) / ctx.frames.frameMs);
      const stimulus = stimulusName();
      if (stimulus) data.stimulus = stimulus;
      ctx.bus.emit({ source: 'task', type: 'phase.offset', t: now, data });
      ctx.mapping.setAccepted([]);
      ctx.bus.setContext({ phase: null });
      spec.onEnd?.();
    },
  };
  return { conditional_function: () => !spec.skip?.(), timeline: [trial] };
}
