// Wires the framework together for one page: clock, bus, stage, input, mapping, bridge,
// jsPsych, and the ModuleContext that modules receive. Nothing here decides what happens
// next; that is session/run-session.js.
import { schedule as defaultSchedule, createClock } from '../foundation/clock.js';
import { createBus } from '../foundation/events.js';
import { defaultParams, renderStimulus } from '../authoring/modules/render.js';
import { createJsPsych } from '../authoring/modules/jspsych.js';
import { createBridge } from '../pipeline/bridge.js';
import { createFrames } from '../pipeline/frames.js';
import { createInput } from '../pipeline/input.js';
import { mergeScopes } from '../pipeline/input-scope.js';
import { createMapping } from '../pipeline/mapping.js';
import { createTriggers } from '../pipeline/triggers.js';
import { createSinks } from './sinks.js';
import { createCursor } from '../stage/cursor.js';
import { createDisplayFit } from '../stage/display-fit.js';
import { createLayout } from '../stage/layout.js';
import { createOverlay, overlayReserve } from '../stage/overlay.js';
import { createStage } from '../stage/stage.js';
import { THEME_CSS } from '../stage/theme.js';

/** Frame time assumed for `{frames}` durations until the display is measured (M10). */
export const DEFAULT_FRAME_MS = 1000 / 60;

function injectCss(doc, id, css) {
  if (!css || doc.getElementById(id)) return;
  const style = doc.createElement('style');
  style.id = id;
  style.textContent = css;
  doc.head.append(style);
}

/**
 * @param {{root: HTMLElement, plan: object, generators?: Record<string, object>, validate?: Function, timeScale?: number, styles?: string[]}} options
 */
export function createServices({ root, plan, generators = {}, validate, timeScale = 1, styles = [], apis }) {
  const doc = root.ownerDocument;
  const clock = createClock();
  const bus = createBus({ clock, validate, recording: false });
  const calibration = plan.device?.calibration;
  const { screen } = doc.defaultView;
  const shortSide = Math.min(screen?.width ?? Infinity, screen?.height ?? Infinity); // the device's, so it does not change when the window is resized
  const reserve = overlayReserve(plan.overlay, calibration, shortSide);
  const stage = createStage({ root, bus, spec: plan.stage, calibration, reserve });
  const overlay = createOverlay({ root, bus, spec: plan.overlay, calibration, viewport: () => ({ w: root.clientWidth, h: root.clientHeight }), schedule: defaultSchedule, shortSide });
  const input = createInput({ bus, stage });
  const cursor = createCursor({ element: stage.root });
  input.onActivity((move) => cursor.moved(move));
  const bridge = createBridge({ bus });
  const mapping = createMapping({ bus, hooks: { applyEffect: (effect, refs) => stage.applyEffect(effect, refs) } });
  input.setConsumer((candidate) => mapping.wouldConsume(candidate));

  injectCss(doc, 'cndlpsych-theme', THEME_CSS); // before the experiment's styles, so those win
  styles.forEach((css, i) => injectCss(doc, `cndlpsych-style-${i}`, css));
  const display = doc.createElement('div');
  display.className = 'cndlpsych-display';
  stage.element.append(display);
  const displayFit = createDisplayFit({ display, root: stage.root, stage, border: reserve });
  const jsPsych = createJsPsych({ display, extensions: [bridge.Extension] });

  const state = { profile: null, scope: null, session: {}, onRequiredLost: () => {}, frameMs: DEFAULT_FRAME_MS, inputProfiles: [] };
  const sinkSet = createSinks({ plan, bus, clock, apis, onRequiredLost: (id) => state.onRequiredLost(id) });
  const triggers = createTriggers({ bus, clock, sinks: sinkSet.sinks, context: () => state.session });
  const frames = createFrames({ frameMs: DEFAULT_FRAME_MS });
  const scale = (ms) => Math.max(0, Math.round(ms * timeScale));

  /** The scope for this device from `{profile: scope}`: its own profile's, plus those of the other input sources it has. */
  function inputScope(byProfile) {
    const [own, ...others] = [state.profile, ...state.inputProfiles.filter((id) => id !== state.profile)];
    return mergeScopes(byProfile[own], others.map((id) => byProfile[id]));
  }

  // The hint of an intent: from the current scope, else from the first block that defines it
  // (instructions often mention an intent that a later block declares).
  function hint(name) {
    const own = state.scope?.intents[name]?.hint;
    if (own !== undefined) return own;
    for (const block of plan.blocks) {
      const found = inputScope(block.input)?.intents[name]?.hint;
      if (found !== undefined) return found;
    }
    return undefined;
  }

  function render(definition, { trial, rng, vars }) {
    const generator = generators[definition.type];
    const rendered = renderStimulus(definition, {
      styles: plan.styles,
      hint,
      vars,
      generators,
      generatorContext: {
        rng,
        layout: createLayout({ rng: rng.fork('layout'), size: { w: stage.rect.w, h: stage.rect.h }, toPx: (length) => stage.lengthToPx(length) }),
        log: { debug() {}, info() {}, warn: (...args) => console.warn(...args) },
        profile: state.profile,
        trial,
      },
    });
    if (generator) injectCss(doc, `cndlpsych-generator-${definition.type}`, rendered.css);
    return rendered;
  }

  function moduleContext({ rng, profile }) {
    state.profile = profile;
    return {
      bus, clock, rng, profile, jsPsych, bridge, mapping, plan,
      frameMs: state.frameMs,
      scale,
      schedule: defaultSchedule,
      frames,
      inputScope,
      applyScope(scope) {
        state.scope = scope;
        mapping.setScope(scope, profile, { toPx: (length) => stage.lengthToPx(length) });
        input.configure(scope);
        cursor.configure(scope.cursor);
        bridge.setIntents(scope.intents);
      },
      applyTriggers: (scope) => triggers.setScope(scope),
      renderStimulus(name, options) {
        const definition = plan.stimuli[name];
        if (!definition) throw new Error(`unknown stimulus "${name}"`);
        return render(definition, options);
      },
      renderDefinition: render,
    };
  }

  return {
    clock, bus, stage, input, cursor, bridge, mapping, jsPsych, display, moduleContext, defaultParams, triggers, sinkSet, scale, overlay, frames,
    /** 'stage' while a block of stimuli runs (the display is the stage), 'text' for forms and messages (it reaches past the overlay border). */
    setDisplayMode: displayFit.mode,
    /** Session answers that trigger values and fields can read ({subject, session, device}). */
    setSessionContext(context) { state.session = context; },
    /** Called when a required sink is lost while recording. */
    onRequiredSinkLost(handler) { state.onRequiredLost = handler; },
    /** The measured frame time, used for `{frames}` durations from the next block on. */
    /** The profiles whose inputs the device has (its own first); their bindings all apply. */
    setInputProfiles(profiles) { state.inputProfiles = profiles; },
    setFrameMs(ms) {
      state.frameMs = ms;
      frames.setFrameMs(ms);
    },
  };
}
