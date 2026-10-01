import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { eventProblems } from '../../tools/validators.js';
import { createFakeTime } from '../../tools/fake-time.js';
import { createBus } from '../foundation/events.js';
import { createSink } from './sink.js';
import { createTriggers, resolveValue } from './triggers.js';

const example = load(readFileSync(join(import.meta.dirname, '..', '..', 'spec', 'examples', 'experiment.yaml'), 'utf8'));

function setup(sinkConfigs, { context } = {}) {
  const time = createFakeTime();
  const bus = createBus({ clock: time.clock, validate: eventProblems });
  const events = [];
  bus.on('*', (e) => events.push(e));
  const written = {};
  const sinks = new Map();
  for (const config of sinkConfigs) {
    written[config.id] = [];
    const transport = { connect: async () => {}, write: async (data) => { written[config.id].push(typeof data === 'string' ? data : [...data]); }, close: async () => {} };
    sinks.set(config.id, createSink(config, transport, { clock: time.clock, schedule: time.schedule, report: { status() {}, sync() {} } }));
  }
  const triggers = createTriggers({ bus, clock: time.clock, sinks, context });
  return {
    time, bus, events, written, triggers, sinks,
    connect: () => Promise.all([...sinks.values()].map((s) => s.connect())),
    scope: (rules, extra = {}) => triggers.setScope({ enabled: true, rules, ...extra }),
    ofType: (type) => events.filter((e) => e.type === type),
    emit(type, data = {}, extra = {}) {
      return bus.emit({ source: type.startsWith('phase.') || type.startsWith('response.') ? 'task' : 'system', type, data, ...extra });
    },
    settle: () => time.settle(),
  };
}
const RAW = { id: 'eeg', type: 'serial', format: 'raw' };
const NDJSON = { id: 'lab', type: 'websocket', format: 'ndjson', fields: ['seq', 'value', 'event', 'stimulus', 'trial'] };
const onset = (stimulus) => ({ phase: 'p', stimulus, planned_ms: 100 });

describe('resolveValue', () => {
  const lookup = (path) => ({ 'target.id': 4, 'subject.age': 24, key: 'b', neg: -1, text: 'x' })[path];
  it.each([
    [21, { value: 21 }], [0, { value: 0 }],
    [{ from: 'target.id' }, { value: 4 }], [{ from: 'subject.age' }, { value: 24 }],
    [{ from: 'missing' }, { reason: 'error' }], [{ from: 'neg' }, { reason: 'out_of_range' }], [{ from: 'text' }, { reason: 'out_of_range' }],
    [{ map: { by: 'key', table: { a: 1, b: 2 } } }, { value: 2 }],
    [{ map: { by: 'key', table: { z: 1 }, default: 9 } }, { value: 9 }],
    [{ map: { by: 'key', table: { z: 1 } } }, { reason: 'error' }],
    [{ map: { by: 'missing', table: { a: 1 }, default: 7 } }, { reason: 'error' }],
  ])('%j', (spec, expected) => {
    expect(resolveValue(spec, lookup)).toEqual(expected);
  });
});

describe('matching and sending', () => {
  it('a matching rule writes the value and reports trigger.sent with the cause time and hand-off time', async () => {
    const t = setup([RAW]);
    await t.connect();
    t.scope([{ id: 'onset', on: 'phase.onset', where: { stimulus: 'a' }, value: 31 }]);
    t.time.now = 100;
    const cause = t.emit('phase.onset', onset('a'), { t: 98.5 });
    await t.settle();
    expect(t.written.eeg).toEqual([[31]]);
    const [sent] = t.ofType('trigger.sent');
    expect(sent).toMatchObject({ source: 'trigger', caused_by: cause.seq, data: { sink: 'eeg', rule: 'onset', value: 31, event_seq: cause.seq, t_event: 98.5, t_sent: 100, bytes: 1 } });
  });

  it('ignores events that do not match (type or where)', async () => {
    const t = setup([RAW]);
    await t.connect();
    t.scope([{ id: 'onset', on: 'phase.onset', where: { stimulus: 'a' }, value: 1 }]);
    t.emit('phase.onset', onset('b'));
    t.emit('phase.offset', { phase: 'p', reason: 'duration' });
    await t.settle();
    expect(t.written.eeg).toEqual([]);
  });

  it('does nothing when the scope is disabled, or before any scope is set', async () => {
    const t = setup([RAW]);
    await t.connect();
    t.emit('phase.onset', onset('a'));
    t.triggers.setScope({ enabled: false, rules: [{ id: 'r', on: 'phase.onset', value: 1 }] });
    t.emit('phase.onset', onset('a'));
    await t.settle();
    expect(t.written.eeg).toEqual([]);
  });

  it('two sinks fire from one rule, each with its own format', async () => {
    const t = setup([{ ...RAW, template: '{value:02x}' }, NDJSON]);
    await t.connect();
    t.scope([{ id: 'both', on: 'phase.onset', value: 12 }]);
    t.bus.setContext({ trial: 2 });
    const cause = t.emit('phase.onset', onset('search_array'));
    await t.settle();
    expect(t.written.eeg).toEqual([[12]]);
    expect(JSON.parse(t.written.lab[0])).toEqual({ seq: cause.seq, value: 12, event: 'phase.onset', stimulus: 'search_array', trial: 2 });
    expect(t.ofType('trigger.sent').map((e) => e.data.sink).sort()).toEqual(['eeg', 'lab']);
  });

  it('rule.sinks restricts the targets', async () => {
    const t = setup([RAW, NDJSON]);
    await t.connect();
    t.scope([{ id: 'only_lab', on: 'phase.onset', value: 3, sinks: ['lab'] }]);
    t.emit('phase.onset', onset('a'));
    await t.settle();
    expect(t.written.eeg).toEqual([]);
    expect(t.written.lab).toHaveLength(1);
  });

  it('globs and where operators work as in input rules', async () => {
    const t = setup([RAW]);
    await t.connect();
    t.scope([{ id: 'g', on: 'phase.*', where: { stimulus: 'oddball_*' }, value: 5 }]);
    t.emit('phase.onset', onset('oddball_A'));
    t.emit('phase.offset', { phase: 'p', stimulus: 'oddball_B', reason: 'duration' });
    t.emit('phase.onset', onset('other'));
    await t.settle();
    expect(t.written.eeg).toEqual([[5], [5]]);
  });

  it('does not react to its own events or storage events', async () => {
    const t = setup([RAW]);
    await t.connect();
    t.scope([{ id: 'loop', on: 'trigger.*', value: 1 }]);
    t.bus.emit({ source: 'trigger', type: 'sink.status', data: { sink: 'eeg', state: 'connected' } });
    await t.settle();
    expect(t.written.eeg).toEqual([]);
  });
});

describe('values', () => {
  it('{from} reads the event, then the session context', async () => {
    const t = setup([RAW], { context: () => ({ subject: { age: 24 }, session: { session_id: 'ses-01' }, device: { profile: 'phone' } }) });
    await t.connect();
    t.scope([{ id: 'a', on: 'response.evaluated', value: { from: 'rt_ms' } }, { id: 'b', on: 'phase.onset', value: { from: 'subject.age' } }]);
    t.emit('response.evaluated', { intent: 'go', correct: true, rt_ms: 42 });
    t.emit('phase.onset', onset('x'));
    await t.settle();
    expect(t.written.eeg).toEqual([[42], [24]]);
  });

  it('{map} looks up a field of the event', async () => {
    const t = setup([RAW]);
    await t.connect();
    t.scope([{ id: 'm', on: 'phase.onset', value: { map: { by: 'stimulus', table: { a: 10, b: 20 }, default: 99 } } }]);
    for (const s of ['a', 'b', 'c']) t.emit('phase.onset', onset(s));
    await t.settle();
    expect(t.written.eeg).toEqual([[10], [20], [99]]);
  });

  it('drops with a reason when the value cannot be resolved or does not fit the sink', async () => {
    const t = setup([RAW]);
    await t.connect();
    t.scope([
      { id: 'none', on: 'phase.onset', where: { stimulus: 'a' }, value: { from: 'nothing' } },
      { id: 'big', on: 'phase.onset', where: { stimulus: 'b' }, value: 300 },
    ]);
    t.emit('phase.onset', onset('a'));
    t.emit('phase.onset', onset('b'));
    await t.settle();
    expect(t.written.eeg).toEqual([]);
    expect(t.ofType('trigger.dropped').map((e) => [e.data.rule, e.data.reason, e.data.value])).toEqual([['none', 'error', null], ['big', 'out_of_range', 300]]);
  });

  it('a value that is too big for a raw sink still goes to a text sink', async () => {
    const t = setup([RAW, NDJSON]);
    await t.connect();
    t.scope([{ id: 'big', on: 'phase.onset', value: 300 }]);
    t.emit('phase.onset', onset('a'));
    await t.settle();
    expect(t.written.eeg).toEqual([]);
    expect(JSON.parse(t.written.lab[0]).value).toBe(300);
    expect(t.ofType('trigger.dropped').map((e) => e.data.sink)).toEqual(['eeg']);
  });
});

describe('once, priority and several rules', () => {
  it('once fires a rule a single time, across scope changes', async () => {
    const t = setup([RAW]);
    await t.connect();
    const rules = [{ id: 'first', on: 'phase.onset', once: true, value: 1 }];
    t.scope(rules);
    t.emit('phase.onset', onset('a'));
    t.emit('phase.onset', onset('a'));
    t.scope(rules);
    t.emit('phase.onset', onset('a'));
    await t.settle();
    expect(t.written.eeg).toEqual([[1]]);
  });

  it('runs rules by priority, then definition order; each matching rule fires', async () => {
    const t = setup([RAW]);
    await t.connect();
    t.scope([
      { id: 'low', on: 'phase.onset', value: 1 },
      { id: 'high', on: 'phase.onset', value: 2, priority: 10 },
      { id: 'mid_a', on: 'phase.onset', value: 3, priority: 5 },
      { id: 'mid_b', on: 'phase.onset', value: 4, priority: 5, allow_multiple: true },
    ]);
    t.emit('phase.onset', onset('a'));
    await t.settle();
    expect(t.written.eeg).toEqual([[2], [3], [4], [1]]);
  });

  it('switching scope replaces the rules', async () => {
    const t = setup([RAW]);
    await t.connect();
    t.scope([{ id: 'a', on: 'phase.onset', value: 1 }]);
    t.emit('phase.onset', onset('x'));
    t.scope([{ id: 'b', on: 'phase.onset', value: 2 }]);
    t.emit('phase.onset', onset('x'));
    await t.settle();
    expect(t.written.eeg).toEqual([[1], [2]]);
  });
});

describe('disconnected sinks', () => {
  it('drop with the reason disconnected', async () => {
    const t = setup([RAW]);
    t.scope([{ id: 'r', on: 'phase.onset', value: 1 }]);
    t.emit('phase.onset', onset('a'));
    await t.settle();
    expect(t.ofType('trigger.dropped').map((e) => e.data.reason)).toEqual(['disconnected']);
  });
});

describe('the experiment.yaml example', () => {
  it('sends the response codes to both sinks: raw hex byte plus reset, and ndjson with the listed fields', async () => {
    const [serial, websocket] = example.triggers.sinks;
    const t = setup([{ ...serial }, { ...websocket }]);
    await t.connect();
    t.scope(example.triggers.rules);
    const cause = t.emit('response.evaluated', { intent: 'go', correct: true, rt_ms: 301 });
    await t.settle();
    await t.time.advance(5);
    expect(t.written.eeg_serial).toEqual([[21], [0]]);
    expect(JSON.parse(t.written.lab_ws[0])).toMatchObject({ seq: cause.seq, value: 21, event: 'response.evaluated' });
    expect(Object.keys(JSON.parse(t.written.lab_ws[0]))).toEqual(['seq', 'value', 'event', 't_event', 't_sent']);
    t.emit('response.timeout', { phase: 'p', timeout_ms: 10 });
    await t.settle();
    expect(t.written.eeg_serial.at(-1)).toEqual([23]);
  });
});
