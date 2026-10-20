// The one predicate / pattern engine, used by input rules and trigger rules.
// Pure: no DOM, no clock, no randomness. Semantics follow common.schema.yaml
// (`condition`, `predicate`, `step`, `pattern`).
import { durationMs } from './clock.js';
import { typeMatches } from './events.js';

const COMBINATORS = ['all', 'any', 'not'];
const MAX_PARTIALS_WITH_DISTINCT = 8;
const MAX_UNORDERED_CANDIDATES = 64;

// ---------------------------------------------------------------- values ---

/** Value at a dotted path ('target.role'); undefined when any segment is missing. */
export function getPath(subject, path) {
  let value = subject;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return value;
}

/** '*' matches any run of characters (including dots); everything else is literal. */
export function globToRegExp(glob) {
  const escaped = glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${escaped}$`, 's');
}

function scalarTest(expected) {
  if (typeof expected === 'string' && expected.includes('*')) {
    const regExp = globToRegExp(expected);
    return (value) => typeof value === 'string' && regExp.test(value);
  }
  return (value) => value === expected;
}

const NUMERIC = {
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
};

function operatorTest(name, argument) {
  switch (name) {
    case 'eq': return scalarTest(argument);
    case 'ne': { const eq = scalarTest(argument); return (value) => !eq(value); }
    case 'in': { const tests = argument.map(scalarTest); return (value) => tests.some((test) => test(value)); }
    case 'not_in': { const tests = argument.map(scalarTest); return (value) => !tests.some((test) => test(value)); }
    case 'gt': case 'gte': case 'lt': case 'lte':
      return (value) => typeof value === 'number' && NUMERIC[name](value, argument);
    case 'glob': { const regExp = globToRegExp(argument); return (value) => typeof value === 'string' && regExp.test(value); }
    case 'regex': { const regExp = new RegExp(argument); return (value) => typeof value === 'string' && regExp.test(value); }
    case 'exists': return (value) => (value !== undefined) === argument;
    default: throw new TypeError(`unknown condition operator "${name}"`);
  }
}

/**
 * A condition is a scalar (equality; strings may contain * globs), null (value is null or
 * missing), a list (membership) or an object of operators that must all hold.
 * @returns {(value: unknown) => boolean}
 */
export function compileCondition(condition) {
  if (condition === null) return (value) => value === null || value === undefined;
  if (Array.isArray(condition)) {
    const tests = condition.map(scalarTest);
    return (value) => tests.some((test) => test(value));
  }
  if (typeof condition === 'object') {
    const tests = Object.entries(condition).map(([name, argument]) => operatorTest(name, argument));
    return (value) => tests.every((test) => test(value));
  }
  return scalarTest(condition);
}

// ------------------------------------------------------------ predicates ---

/**
 * A predicate is a map of field path -> condition (all must hold), optionally combined
 * with all / any / not. The empty predicate matches everything.
 * @returns {(subject: object) => boolean}
 */
export function compilePredicate(predicate = {}) {
  const fields = Object.entries(predicate)
    .filter(([key]) => !COMBINATORS.includes(key))
    .map(([path, condition]) => [path, compileCondition(condition)]);
  const all = (predicate.all ?? []).map(compilePredicate);
  const any = predicate.any ? predicate.any.map(compilePredicate) : null;
  const not = predicate.not ? compilePredicate(predicate.not) : null;

  return (subject) => fields.every(([path, test]) => test(getPath(subject, path)))
    && all.every((test) => test(subject))
    && (any === null || any.some((test) => test(subject)))
    && (not === null || !not(subject));
}

export const matchesPredicate = (predicate, subject) => compilePredicate(predicate)(subject);

// ----------------------------------------------------------------- steps ---

/** The object a step's `where` is evaluated against: event data plus block / trial / phase. */
export function eventSubject(event) {
  return { ...event.data, block: event.block, trial: event.trial, phase: event.data.phase ?? event.phase };
}

/** @returns {(event: object) => boolean} */
export function compileStep(step) {
  const where = compilePredicate(step.where);
  const minMs = step.min_ms;
  return (event) => typeMatches(step.on, event.type)
    && where(eventSubject(event))
    && (minMs === undefined || (typeof event.data.duration_ms === 'number' && event.data.duration_ms >= minMs));
}

// --------------------------------------------------------------- patterns ---

const result = (events) => ({ events, t_first: events[0].t, t_last: events.at(-1).t });

function distinctPredicate(field) {
  if (field === undefined) return () => true;
  const valueOf = (event) => getPath(eventSubject(event), field);
  return (event, chosen) => {
    const value = valueOf(event);
    return value !== undefined && chosen.every((other) => valueOf(other) !== value);
  };
}

function orderedMatcher(steps, options, initial = []) {
  const { within, distinct, cap } = options;
  let partials = initial;

  function advance(event) {
    const extended = [];
    for (const partial of partials) {
      if (event.t - partial[0].t > within) continue;
      const next = steps[partial.length];
      if (next(event) && distinct(event, partial)) extended.push([...partial, event]);
      else extended.push(partial);
    }
    if (steps[0](event)) extended.push([event]);
    return extended;
  }

  return {
    feed(event) {
      const candidates = advance(event);
      const done = candidates.filter((chain) => chain.length === steps.length && chain.at(-1) === event);
      if (done.length) {
        partials = [];
        return result(done.sort((a, b) => b[0].t - a[0].t)[0]);
      }
      // Keep, per prefix length, the latest-starting chains (they have the most time left).
      const byLength = new Map();
      for (const chain of candidates.sort((a, b) => b[0].t - a[0].t)) {
        const group = byLength.get(chain.length) ?? [];
        if (group.length < cap) group.push(chain);
        byLength.set(chain.length, group);
      }
      partials = [...byLength.values()].flat();
      return null;
    },
    reset() { partials = []; },
    clone: () => orderedMatcher(steps, options, partials.map((chain) => [...chain])),
  };
}

/** Assign distinct events to steps (any order); the newest event must be used. */
function assign(steps, candidates, newest, { within, distinct }) {
  const chosen = [];
  const search = (step) => {
    if (step === steps.length) {
      const times = chosen.map((event) => event.t);
      return chosen.includes(newest) && Math.max(...times) - Math.min(...times) <= within;
    }
    for (const candidate of candidates) {
      if (chosen.includes(candidate) || !steps[step](candidate) || !distinct(candidate, chosen)) continue;
      chosen.push(candidate);
      if (search(step + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return search(0) ? [...chosen].sort((a, b) => a.t - b.t) : null;
}

function unorderedMatcher(steps, options, initial = []) {
  let candidates = initial;
  return {
    feed(event) {
      if (!steps.some((step) => step(event))) return null;
      candidates = candidates.filter((c) => event.t - c.t <= options.within);
      candidates.push(event);
      candidates = candidates.slice(-MAX_UNORDERED_CANDIDATES);
      const found = candidates.length >= steps.length ? assign(steps, candidates, event, options) : null;
      if (!found) return null;
      candidates = [];
      return result(found);
    },
    reset() { candidates = []; },
    clone: () => unorderedMatcher(steps, options, [...candidates]),
  };
}

/**
 * Stateful matcher for a `pattern`: a single step, or a `sequence` (ordered by default;
 * `unordered: true` accepts any order) with optional `distinct_by` and `within`.
 * Feed it every event in order; it returns {events, t_first, t_last} when the pattern
 * completes (and then starts over), otherwise null. Non-matching events are ignored.
 * `peek(event)` says whether feeding the event would complete the pattern, without changing state.
 * Ordered sequences are matched greedily: the latest-starting partial match wins.
 * @param {{frameMs?: number}} [options] only needed when `within` is given in frames
 */
export function createPatternMatcher(pattern, { frameMs } = {}) {
  if (!pattern.sequence) {
    const step = compileStep(pattern);
    const matcher = { feed: (event) => (step(event) ? result([event]) : null), reset() {}, clone: () => matcher };
    return { ...matcher, peek: (event) => matcher.feed(event) !== null };
  }
  const steps = pattern.sequence.map(compileStep);
  const distinct = distinctPredicate(pattern.distinct_by);
  const within = pattern.within === undefined ? Infinity : durationMs(pattern.within, frameMs);
  const matcher = pattern.unordered
    ? unorderedMatcher(steps, { within, distinct })
    : orderedMatcher(steps, { within, distinct, cap: pattern.distinct_by ? MAX_PARTIALS_WITH_DISTINCT : 1 });
  return { ...matcher, peek: (event) => matcher.clone().feed(event) !== null };
}
