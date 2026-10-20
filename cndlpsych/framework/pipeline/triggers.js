// The trigger engine: rules from the resolved scope of the current block / trial turn bus
// events into sink messages. A match produces trigger.sent (with the causing event's t and
// the time the message was handed to the sink) or trigger.dropped (with a reason). Rules see
// every event except the engine's own (source trigger / storage), so they cannot loop.
import { compileStep, eventSubject, getPath } from '../foundation/matcher.js';

const OWN_SOURCES = new Set(['trigger', 'storage']);

/**
 * The integer a rule sends: a literal, a field of the event / context, or a table lookup.
 * @returns {{value: number}|{reason: string}}
 */
export function resolveValue(spec, lookup) {
  let value = spec;
  if (spec !== null && typeof spec === 'object') {
    if ('from' in spec) {
      value = lookup(spec.from);
    } else {
      const key = lookup(spec.map.by);
      value = key === undefined || key === null ? undefined : spec.map.table[String(key)] ?? spec.map.default;
    }
  }
  if (value === undefined || value === null) return { reason: 'error' };
  return Number.isInteger(value) && value >= 0 ? { value } : { reason: 'out_of_range' };
}

/**
 * @param {{
 *   bus: object, clock: {now: () => number, toWall: (t: number) => number},
 *   sinks: Map<string, {send: Function, format: string}>,
 *   context?: () => {subject?: object, session?: object, device?: object},
 * }} options `context` supplies the session answers that `{from}` values and fields can read
 */
export function createTriggers({ bus, clock, sinks, context = () => ({}) }) {
  let rules = [];
  let enabled = false;
  const fired = new Set();

  function fieldsFor(event, rule, value, subject, ctx) {
    return {
      seq: event.seq,
      value,
      event: event.type,
      rule: rule.id,
      t_event: event.t,
      time_origin_ms: clock.toWall(0),
      session_id: ctx.session?.session_id,
      block: event.block ?? undefined,
      trial: event.trial ?? undefined,
      phase: subject.phase ?? undefined,
      stimulus: event.data.stimulus,
      correct: event.data.correct ?? undefined,
      rt_ms: event.data.rt_ms ?? undefined,
      profile: ctx.device?.profile,
    };
  }

  function report(event, rule, sinkId, value, outcome) {
    if (outcome.sent) {
      bus.emit({
        source: 'trigger', type: 'trigger.sent', caused_by: event.seq,
        data: { sink: sinkId, rule: rule.id, value, event_seq: event.seq, t_event: event.t, t_sent: outcome.t_sent, bytes: outcome.bytes },
      });
    } else {
      bus.emit({
        source: 'trigger', type: 'trigger.dropped', caused_by: event.seq,
        data: { sink: sinkId, rule: rule.id, value, event_seq: event.seq, reason: outcome.reason },
      });
    }
  }

  function fire(event, rule, subject) {
    const ctx = context();
    const lookup = (path) => getPath(subject, path) ?? getPath(ctx, path);
    const resolved = resolveValue(rule.value, lookup);
    const targets = (rule.sinks ?? [...sinks.keys()]).map((id) => [id, sinks.get(id)]).filter(([, sink]) => sink);
    for (const [id, sink] of targets) {
      if (resolved.reason) {
        report(event, rule, id, null, { sent: false, reason: resolved.reason });
        continue;
      }
      sink.send(fieldsFor(event, rule, resolved.value, subject, ctx)).then((outcome) => report(event, rule, id, resolved.value, outcome));
    }
  }

  const stopListening = bus.on('*', (event) => {
    if (!enabled || OWN_SOURCES.has(event.source)) return;
    const subject = eventSubject(event);
    for (const rule of rules) {
      if (rule.once && fired.has(rule.id)) continue;
      if (!rule.test(event)) continue;
      fired.add(rule.id);
      fire(event, rule, subject);
    }
  });

  return {
    /**
     * Apply the resolved trigger scope of the current block / trial.
     * @param {{enabled: boolean, rules: object[]}} scope
     */
    setScope(scope) {
      enabled = scope.enabled;
      rules = scope.rules
        .map((rule, order) => ({ ...rule, order, test: compileStep({ on: rule.on, where: rule.where }) }))
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.order - b.order);
    },
    dispose() { stopListening(); },
  };
}
