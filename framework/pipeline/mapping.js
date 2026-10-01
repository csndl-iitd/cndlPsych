// Mapping: the already-resolved input scope of the current block / trial becomes
// semantic events. Bindings (per-intent shorthand) and explicit rules are compiled to the
// same thing: a pattern from the shared matcher plus an emission. Nothing is merged here;
// the compiler did that (ARCHITECTURE.md section 6).
//
// Semantic events carry the time of the input that caused them, so response times are
// measured from the participant's action, not from when the mapping ran.
//
// Rules cannot match `semantic.*` events (that would allow loops); they see raw input,
// gestures, and every other non-semantic event.
import { createPatternMatcher } from '../foundation/matcher.js';

const RESET_RANK = { trial: 1, block: 2, session: 3 };
const asList = (value) => (Array.isArray(value) ? value : [value]);

// ---- bindings -> steps ---------------------------------------------------------------
function regionWhere(prefix, region = {}) {
  const where = {};
  for (const axis of ['x', 'y']) {
    if (region[axis]) where[`${prefix}${axis}`] = { gte: region[axis][0], lte: region[axis][1] };
  }
  return where;
}

function targetWhere(target = {}) {
  return {
    ...(target.role === undefined ? {} : { 'target.role': target.role }),
    ...(target.id === undefined ? {} : { 'target.id': target.id }),
  };
}

function bindingStep(binding, toPx) {
  if (binding.key !== undefined) {
    return { on: binding.on === 'up' ? 'input.key.up' : 'input.key.down', where: { key: asList(binding.key), repeat: false } };
  }
  if (binding.tap !== undefined) {
    const options = binding.tap === true ? {} : binding.tap;
    // `on: down` fires on the raw pointer press; otherwise on the recognised tap gesture.
    if (binding.on === 'down') return { on: 'input.pointer.down', where: { ...regionWhere('', options), ...targetWhere(options.target) } };
    return { on: 'input.tap', where: { ...regionWhere('down.', options), ...targetWhere(options.target) } };
  }
  if (binding.swipe !== undefined) {
    const { direction = 'any', min_distance: minDistance, ...region } = binding.swipe;
    return {
      on: 'input.swipe',
      where: {
        ...(direction === 'any' ? {} : { direction }),
        ...(minDistance === undefined ? {} : { distance: { gte: toPx(minDistance) } }),
        ...regionWhere('down.', region),
      },
    };
  }
  const { min_ms: minMs, target, ...region } = binding.longpress;
  return {
    on: 'input.longpress.start',
    where: { ...(minMs === undefined ? {} : { threshold_ms: { gte: minMs } }), ...regionWhere('down.', region), ...targetWhere(target) },
  };
}

/** One rule per binding: id binding:<intent>, or binding:<intent>#n for several. */
export function bindingRules(intents, toPx) {
  return Object.entries(intents).flatMap(([name, { bindings }]) => bindings.map((binding, i) => ({
    id: bindings.length > 1 ? `binding:${name}#${i + 1}` : `binding:${name}`,
    match: bindingStep(binding, toPx),
    emit: { intent: name },
    reset: 'trial',
    consume: true,
    priority: 0,
  })));
}

// ---- mapping -----------------------------------------------------------------------
const sourceOf = (type) => (type.startsWith('task.') ? 'task' : 'semantic');

/**
 * @param {{bus: object, hooks?: {injectKey?: Function, endTrial?: Function, applyEffect?: Function}}} options
 *   hooks: injectKey(key, {rule, origin_t, caused_by}), endTrial({rule, caused_by}),
 *   applyEffect(effect, targetRefs)
 */
export function createMapping({ bus, hooks = {} }) {
  let rules = [];
  let profile = null;
  let accepted = new Set();
  const stopListening = bus.on('*', (event) => {
    if (event.source !== 'semantic') handle(event);
  });

  function targetsFor(effect, events) {
    if (effect.target === 'stage') return [];
    const refs = (effect.target === 'matched_targets' ? events : events.slice(-1)).map((event) => event.data.target);
    return refs.filter(Boolean);
  }

  function emitItem(item, rule, result, cause) {
    const base = { rule: rule.id, profile };
    if (item.intent !== undefined) {
      bus.emit({ source: 'semantic', type: `semantic.${item.intent}`, data: { intent: item.intent, ...base, ...item.data }, t: cause.t, caused_by: cause.seq });
    } else if (item.event !== undefined) {
      bus.emit({ source: sourceOf(item.event), type: item.event, data: { ...base, ...item.data }, t: cause.t, caused_by: cause.seq });
    } else if (item.key !== undefined) {
      hooks.injectKey?.(item.key, { rule: rule.id, origin_t: cause.t, caused_by: cause.seq });
    } else if (item.end_trial) {
      hooks.endTrial?.({ rule: rule.id, caused_by: cause.seq });
    } else if (item.effect) {
      hooks.applyEffect?.(item.effect, targetsFor(item.effect, result.events));
    }
  }

  function handle(event) {
    const fired = [];
    for (const rule of rules) {
      const result = rule.matcher.feed(event);
      if (result) fired.push({ rule, result });
    }
    for (const { rule, result } of fired) {
      for (const item of asList(rule.emit)) emitItem(item, rule, result, event);
    }
    const consumed = fired.some(({ rule }) => rule.consume !== false);
    const isInput = (event.type === 'input.key.down' && !event.data.repeat) || event.type === 'input.tap';
    if (!consumed && isInput && accepted.has('any')) {
      bus.emit({ source: 'semantic', type: 'semantic.any', data: { intent: 'any', rule: 'builtin:any', profile, via: event.type }, t: event.t, caused_by: event.seq });
    }
  }

  return {
    /**
     * @param {{intents: object, rules: object[]}} scope one profile's resolved input scope
     * @param {string} profileId
     * @param {{toPx?: (length: number|string) => number}} [options]
     */
    setScope(scope, profileId, { toPx = (length) => length } = {}) {
      profile = profileId;
      const all = [...bindingRules(scope.intents, toPx), ...scope.rules];
      rules = all
        .map((rule, order) => ({ ...rule, order, matcher: createPatternMatcher(rule.match) }))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.order - b.order);
    },

    /** Intents the current phase accepts ('any' = any key or tap). Responses to other intents are still logged. */
    setAccepted(intents) {
      accepted = new Set(asList(intents).filter((intent) => intent !== undefined));
    },

    /**
     * Would this not-yet-emitted event be swallowed by a rule? input.js asks before emitting
     * a key event, so the page (and jsPsych) never sees a consumed key. Changes no state.
     */
    wouldConsume(candidate) {
      return rules.some((rule) => rule.consume !== false && rule.matcher.peek(candidate));
    },

    /** Clear partial matches of rules whose `reset` is at or below the level (trial < block < session). */
    reset(level) {
      for (const rule of rules) {
        const rank = RESET_RANK[rule.reset ?? 'trial'];
        if (rank !== undefined && rank <= RESET_RANK[level]) rule.matcher.reset();
      }
    },

    get ruleIds() { return rules.map((rule) => rule.id); },
    dispose() { stopListening(); },
  };
}
