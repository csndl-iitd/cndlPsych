// The event bus: one synchronous stream, one clock. Logging and triggers consume this
// stream only. Every event gets a gap-free `seq` (from 0) in emit order, and handlers
// see events in seq order even when a handler emits while another event is delivering.

export const EVENT_VERSION = 1;
export const SOURCES = ['system', 'task', 'input', 'gaze', 'semantic', 'bridge', 'trigger', 'storage'];

const TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
/** t_bus is only recorded when the event reached the bus later than its source time. */
export const T_BUS_THRESHOLD_MS = 1;

const isContextKey = (key) => key === 'block' || key === 'trial' || key === 'phase';

function envelopeProblem(event) {
  if (!SOURCES.includes(event.source)) return `unknown source "${event.source}"`;
  if (typeof event.type !== 'string' || !TYPE_PATTERN.test(event.type)) return `invalid event type "${event.type}"`;
  if (event.data === null || typeof event.data !== 'object' || Array.isArray(event.data)) return 'data must be an object';
  if (event.t !== undefined && !Number.isFinite(event.t)) return 't must be a finite number';
  if (event.trial != null && !(Number.isInteger(event.trial) && event.trial >= 1)) return 'trial is 1-based';
  return null;
}

/** 'input.*' matches input.tap and input.key.down; '*' matches everything; otherwise exact. */
export function typeMatches(pattern, type) {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

/**
 * @param {{clock: {now: () => number}, validate?: (event: object) => string[], onHandlerError?: (error: Error, event: object) => void, recording?: boolean}} options
 *   `validate` (dev builds) returns a list of problems for the full event; any problem throws.
 *   With `recording: false` the bus drops every event (emit returns null, nothing is numbered
 *   or delivered) until startRecording(): this is how nothing is stored before consent and
 *   how the log starts at seq 0 with session.start.
 */
export function createBus({ clock, validate, onHandlerError, recording = true }) {
  let nextSeq = 0;
  let isRecording = recording;
  let context = { block: null, trial: null, phase: null };
  const subscriptions = [];
  const queue = [];
  let delivering = false;

  function build(input) {
    const event = {
      v: EVENT_VERSION,
      seq: nextSeq,
      t: input.t ?? clock.now(),
      source: input.source,
      type: input.type,
      data: input.data ?? {},
    };
    const busTime = clock.now();
    if (input.t !== undefined && busTime - input.t > T_BUS_THRESHOLD_MS) event.t_bus = busTime;
    for (const key of ['block', 'trial', 'phase']) event[key] = input[key] === undefined ? context[key] : input[key];
    event.caused_by = input.caused_by ?? null;
    return event;
  }

  // Every handler runs for every event; the first error is rethrown once delivery is done.
  function deliver(event, errors) {
    for (const subscription of [...subscriptions]) {
      if (!subscription.active || !typeMatches(subscription.pattern, event.type)) continue;
      try {
        subscription.handler(event);
      } catch (error) {
        if (onHandlerError) onHandlerError(error, event);
        else errors.push(error);
      }
    }
  }

  function drain() {
    delivering = true;
    const errors = [];
    while (queue.length) deliver(queue.shift(), errors);
    delivering = false;
    if (errors.length) throw errors[0];
  }

  return {
    /**
     * @param {{source: string, type: string, data?: object, t?: number, block?: string|null, trial?: number|null, phase?: string|null, caused_by?: number|null}} input
     *   block / trial / phase default to the current context; pass null to record none.
     * @returns {object|null} the complete event (its `seq` is final), or null while not recording
     */
    emit(input) {
      if (!isRecording) return null;
      const problem = envelopeProblem(input);
      if (problem) throw new TypeError(`cannot emit: ${problem}`);
      const event = build(input);
      const stampProblem = envelopeProblem(event);
      const problems = stampProblem ? [stampProblem] : validate?.(event) ?? [];
      if (problems.length) throw new TypeError(`invalid ${event.type} event: ${problems.join('; ')}`);
      nextSeq += 1;
      queue.push(event);
      if (!delivering) drain();
      return event;
    },

    /** Subscribe to a type, a 'prefix.*' glob or '*'. Returns an unsubscribe function. */
    on(pattern, handler) {
      const subscription = { pattern, handler, active: true };
      subscriptions.push(subscription);
      return () => {
        subscription.active = false;
        subscriptions.splice(subscriptions.indexOf(subscription), 1);
      };
    },

    /**
     * Begin numbering and delivering events; the next event is seq 0, or `fromSeq` when a
     * saved session is being resumed (the log carries on without a gap or a repeat).
     */
    startRecording({ fromSeq = 0 } = {}) {
      if (!Number.isInteger(fromSeq) || fromSeq < 0) throw new RangeError('fromSeq must be a non-negative integer');
      nextSeq = fromSeq;
      isRecording = true;
    },

    get recording() { return isRecording; },

    /** Set the block / trial / phase stamped on events that do not carry their own. */
    setContext(partial) {
      for (const key of Object.keys(partial)) {
        if (!isContextKey(key)) throw new TypeError(`unknown context key "${key}"`);
      }
      context = { ...context, ...partial };
    },

    get context() { return { ...context }; },
    /** seq of the last emitted event, or -1 before the first. */
    get lastSeq() { return nextSeq - 1; },
  };
}
