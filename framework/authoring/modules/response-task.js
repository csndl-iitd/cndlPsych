// The generic stimulus-response task. A trial instance is: optional start stimulus, the
// sequence, optional feedback, optional end stimulus, then a gap. Responses are semantic
// intents from the mapping, evaluated here against `correct`; the log gets
// response.evaluated / response.timeout / trial.* from the bus, never from jsPsych data.
import { matchesPredicate } from '../../foundation/matcher.js';
import { drawDuration, expandInstances, resolveName } from './plan.js';
import { acceptedIntents, correctRule, trialOutcome } from './outcome.js';
import { phaseTrial } from './phase.js';

function sequenceItems(def, rng) {
  const items = def.sequence.map((item) => (typeof item === 'string' ? { stimulus: item } : item));
  return def.shuffle ? rng.fork('sequence').shuffle(items) : items;
}

/** @param {import('./phase.js').ModuleContext} ctx */
function instanceNode(ctx, planBlock, instance) {
  const { def, defIndex, cell, conditions, number } = instance;
  const rng = ctx.rng.fork(`trial:${number}`);
  const accepted = acceptedIntents(def.response);
  const rule = correctRule(def.correct);
  const endOnResponse = def.on_response !== 'continue';
  const items = sequenceItems(def, rng);
  const timeoutMs = def.timeout === undefined ? null : ctx.scale(drawDuration(def.timeout, rng.fork('timeout'), ctx.frameMs));

  const state = { responses: [], occurrences: {}, ended: false, timedOut: false, phase: null, cancelTimer: null, unsubscribe: null, stimulusData: {} };
  const outcome = () => trialOutcome({ hasRule: Boolean(rule), responses: state.responses, timedOut: state.timedOut });

  // ---- responses -----------------------------------------------------------------
  const context = (phase) => ({ stimulus: phase.stimulus, phase: phase.name, occurrence: state.occurrences[phase.stimulus], index: phase.index, trial: number, ...conditions });
  const inContext = (phase) => !rule?.where || matchesPredicate(rule.where, context(phase));

  function evaluate(event) {
    const { phase } = state;
    const correct = rule ? inContext(phase) && rule.intents.includes(event.data.intent) : null;
    const rt = event.t - (phase.onsetT ?? phase.loadedAt);
    state.responses.push({ correct, rt, phase: phase.name });
    phase.responded = true;
    state.cancelTimer?.();
    ctx.bus.emit({
      source: 'task',
      type: 'response.evaluated',
      t: event.t,
      caused_by: event.seq,
      data: {
        intent: event.data.intent, correct, rt_ms: rt, phase: phase.name, stimulus: phase.stimulus,
        ...(rule ? { expected: rule.intents } : {}), occurrence: state.occurrences[phase.stimulus], rule: event.data.rule,
      },
    });
    if (endOnResponse) state.ended = true;
  }

  function onSemantic(event) {
    const { phase } = state;
    if (phase?.accepts && event.data.intent && accepted.includes(event.data.intent) && event.t >= phase.loadedAt) evaluate(event);
  }

  /** No response during a phase that matches the correct rule's context is a miss. */
  function missIfNeeded(phase) {
    if (!rule || !phase.accepts || state.ended || phase.responded || !inContext(phase)) return;
    state.responses.push({ correct: false, rt: null, phase: phase.name });
    ctx.bus.emit({
      source: 'task',
      type: 'response.evaluated',
      data: { intent: null, correct: false, rt_ms: null, phase: phase.name, stimulus: phase.stimulus, expected: rule.intents, occurrence: state.occurrences[phase.stimulus] },
    });
  }

  /** The response window is counted in frames from the onset frame of the phase that opens it. */
  function startTimeout(phase, onsetT) {
    if (timeoutMs === null || state.cancelTimer || state.responses.length) return;
    state.cancelTimer = ctx.frames.after(onsetT, ctx.frames.framesFor(timeoutMs), () => {
      if (state.ended || state.responses.length) return;
      state.timedOut = true;
      state.ended = true;
      ctx.bus.emit({ source: 'task', type: 'response.timeout', data: { phase: phase.name, timeout_ms: timeoutMs } });
      ctx.jsPsych.finishTrial();
    });
  }

  // ---- phases --------------------------------------------------------------------
  const stimulusFor = (name) => {
    const resolved = resolveName(name, cell);
    const definition = ctx.plan.stimuli[resolved];
    if (!definition) throw new Error(`trial "${def.name}" refers to unknown stimulus "${resolved}"`);
    return { name: resolved, definition };
  };

  const render = (stimulus) => () => {
    state.occurrences[stimulus] = (state.occurrences[stimulus] ?? 0) + 1;
    const rendered = ctx.renderStimulus(stimulus, { trial: number, rng: rng.fork(`stimulus:${stimulus}:${state.occurrences[stimulus]}`), vars: conditions });
    state.stimulusData = rendered.data;
    return rendered.html;
  };

  function stimulusPhase({ name, stimulusName, duration, accepts = false, index = 0, skip }) {
    const { name: stimulus, definition } = stimulusFor(stimulusName);
    const spec = duration === undefined ? (definition.duration ?? null) : duration;
    const durationMs = spec === null ? null : ctx.scale(drawDuration(spec, rng.fork(`duration:${name}`), ctx.frameMs));
    if (durationMs === null && !(accepts && (endOnResponse || timeoutMs !== null))) {
      throw new Error(`phase "${name}" of trial "${def.name}" has no duration and nothing can end it; give the stimulus a duration or let the trial accept a response`);
    }
    const phase = { name, stimulus, index, accepts, onsetT: null, loadedAt: 0, responded: false };
    return phaseTrial(ctx, {
      name,
      stimulus,
      html: render(stimulus),
      stimulusData: () => state.stimulusData,
      durationMs,
      accepted: accepts ? accepted : [],
      endOnResponse: accepts && endOnResponse,
      skip,
      onStart() {
        state.phase = phase;
        phase.loadedAt = ctx.clock.now();
      },
      onOnset(t) {
        phase.onsetT = t;
        if (accepts) startTimeout(phase, t);
      },
      onEnd() {
        missIfNeeded(phase);
        state.phase = null;
      },
      reason: () => (state.timedOut ? 'task' : phase.responded && endOnResponse ? 'response' : 'duration'),
    });
  }

  /** A blank screen of the given length (the gap after a stimulus or a trial); none for a gap of 0, which would still cost a frame. */
  function gapPhase(after, spec, skip) {
    const durationMs = ctx.scale(drawDuration(spec, rng.fork(`gap:${after}`), ctx.frameMs));
    return durationMs > 0 ? phaseTrial(ctx, { name: `${after}_post`, html: () => '', durationMs, skip }) : null;
  }

  const skipWhenEnded = () => state.ended;
  const timeline = [];
  if (def.start) timeline.push(stimulusPhase({ name: 'start', stimulusName: def.start }));

  items.forEach((item, i) => {
    const { name: stimulus, definition } = stimulusFor(item.stimulus);
    const name = item.phase ?? stimulus;
    const accepts = accepted.length > 0 && (def.response_window === 'any' || i === items.length - 1);
    timeline.push(stimulusPhase({ name, stimulusName: item.stimulus, duration: item.duration, accepts, index: i + 1, skip: skipWhenEnded }));
    const post = item.post ?? definition.post;
    const gap = post === undefined ? null : gapPhase(name, post, skipWhenEnded);
    if (gap) timeline.push(gap);
  });

  // Feedback: every branch is built up front and shown only for its outcome.
  const feedback = typeof def.feedback === 'string' ? { always: def.feedback } : (def.feedback ?? {});
  for (const [when, name] of Object.entries(feedback)) {
    timeline.push(stimulusPhase({ name: 'feedback', stimulusName: name, skip: () => when !== 'always' && outcome() !== when }));
  }
  if (def.end) timeline.push(stimulusPhase({ name: 'end', stimulusName: def.end }));
  const trialGap = def.post === undefined ? null : gapPhase('trial', def.post);
  if (trialGap) timeline.push(trialGap);

  return {
    timeline,
    on_timeline_start() {
      ctx.bus.setContext({ trial: number, phase: null });
      ctx.applyScope(ctx.inputScope(planBlock.trials[defIndex].input));
      ctx.applyTriggers(planBlock.trials[defIndex].triggers);
      state.unsubscribe = ctx.bus.on('semantic.*', onSemantic);
      ctx.bus.emit({ source: 'task', type: 'trial.start', data: { trial: number, name: def.name, conditions } });
    },
    on_timeline_finish() {
      state.cancelTimer?.();
      state.unsubscribe?.();
      const first = state.responses.find((r) => r.rt !== null);
      ctx.bus.emit({ source: 'task', type: 'trial.end', data: { trial: number, outcome: outcome(), rt_ms: first ? first.rt : null } });
      ctx.mapping.reset('trial');
      ctx.applyTriggers(planBlock.triggers);
      ctx.bus.setContext({ trial: null, phase: null });
    },
  };
}

/**
 * Build the jsPsych nodes of a response_task block.
 * @param {import('./phase.js').ModuleContext} ctx
 * @param {object} planBlock block of the compiled plan (config, trials with resolved scopes)
 * @param {{skipTrials?: number}} [options] when resuming: the first n trials already ran and are not built again.
 *   The full list is still expanded (same seed, same order), so trial numbers and stimuli match the first attempt.
 * @returns {{nodes: object[], nTrials: number}} nTrials is the whole block, including skipped trials
 */
export function buildResponseTask(ctx, planBlock, { skipTrials = 0 } = {}) {
  const instances = expandInstances(planBlock.config, ctx.rng.fork('order'));
  const remaining = instances.filter((instance) => instance.number > skipTrials);
  return { nodes: remaining.map((instance) => instanceNode(ctx, planBlock, instance)), nTrials: instances.length };
}
