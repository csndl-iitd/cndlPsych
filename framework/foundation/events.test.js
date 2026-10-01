import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventProblems, eventSchema } from '../../tools/validators.js';
import { createBus, SOURCES, typeMatches } from './events.js';

function fakeClock(start = 0) {
  const clock = { time: start, now: () => clock.time };
  return clock;
}
const tick = (clock, ms = 1) => { clock.time += ms; };
const system = (type, data = {}) => ({ source: 'system', type, data });

function collect(bus, pattern = '*') {
  const seen = [];
  bus.on(pattern, (event) => seen.push(event));
  return seen;
}

describe('createBus', () => {
  it('numbers events from 0, gap-free, in emit order', () => {
    const clock = fakeClock();
    const bus = createBus({ clock });
    const seen = collect(bus);
    for (let i = 0; i < 100; i += 1) {
      tick(clock);
      bus.emit(system('page.focus', { focused: i % 2 === 0 }));
    }
    expect(seen.map((e) => e.seq)).toEqual(Array.from({ length: 100 }, (_, i) => i));
    expect(bus.lastSeq).toBe(99);
  });

  it('keeps seq strictly increasing and gap-free when events are rejected', () => {
    const bus = createBus({ clock: fakeClock() });
    const seen = collect(bus);
    bus.emit(system('page.focus', { focused: true }));
    expect(() => bus.emit({ source: 'nope', type: 'page.focus', data: {} })).toThrow(/unknown source/);
    expect(() => bus.emit(system('Page.Focus'))).toThrow(/invalid event type/);
    expect(() => bus.emit({ source: 'system', type: 'page.focus', data: [] })).toThrow(/data must be an object/);
    expect(() => bus.emit({ ...system('page.focus'), trial: 0 })).toThrow(/1-based/);
    bus.emit(system('page.focus', { focused: false }));
    expect(seen.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('fills the envelope: version, time from the clock, context, null caused_by', () => {
    const clock = fakeClock(42);
    const bus = createBus({ clock });
    const [event] = [bus.emit(system('page.focus', { focused: true }))];
    expect(event).toEqual({ v: 1, seq: 0, t: 42, source: 'system', type: 'page.focus', data: { focused: true }, block: null, trial: null, phase: null, caused_by: null });
  });

  it('stamps block / trial / phase from the context unless the event carries its own', () => {
    const bus = createBus({ clock: fakeClock() });
    bus.setContext({ block: 'b1', trial: 3, phase: 'search' });
    expect(bus.emit(system('page.focus', { focused: true }))).toMatchObject({ block: 'b1', trial: 3, phase: 'search' });
    expect(bus.emit({ ...system('page.focus', { focused: true }), trial: null, phase: 'x' })).toMatchObject({ block: 'b1', trial: null, phase: 'x' });
    bus.setContext({ trial: null });
    expect(bus.context).toEqual({ block: 'b1', trial: null, phase: 'search' });
    expect(() => bus.setContext({ stage: 1 })).toThrow(/unknown context key/);
  });

  it('keeps the source time and adds t_bus only when the event reached the bus later', () => {
    const clock = fakeClock(100);
    const bus = createBus({ clock });
    expect(bus.emit({ ...system('page.focus', { focused: true }), t: 99.5 })).not.toHaveProperty('t_bus');
    const late = bus.emit({ ...system('page.focus', { focused: true }), t: 90 });
    expect(late.t).toBe(90);
    expect(late.t_bus).toBe(100);
  });

  it('delivers to exact, glob and wildcard subscribers, and stops after unsubscribe', () => {
    const bus = createBus({ clock: fakeClock() });
    const exact = collect(bus, 'input.tap');
    const glob = collect(bus, 'input.*');
    const all = collect(bus);
    const off = bus.on('page.focus', () => { throw new Error('should have been removed'); });
    off();
    bus.emit({ source: 'input', type: 'input.tap', data: {} });
    bus.emit({ source: 'input', type: 'input.key.down', data: {} });
    bus.emit(system('page.focus', { focused: true }));
    expect(exact.map((e) => e.type)).toEqual(['input.tap']);
    expect(glob.map((e) => e.type)).toEqual(['input.tap', 'input.key.down']);
    expect(all).toHaveLength(3);
  });

  it('delivers in seq order even when a handler emits during delivery', () => {
    const bus = createBus({ clock: fakeClock() });
    const order = [];
    bus.on('input.tap', (event) => {
      order.push(`first:${event.seq}`);
      bus.emit({ source: 'semantic', type: 'semantic.go', data: {}, caused_by: event.seq });
    });
    bus.on('*', (event) => order.push(`all:${event.type}`));
    bus.emit({ source: 'input', type: 'input.tap', data: {} });
    expect(order).toEqual(['first:0', 'all:input.tap', 'all:semantic.go']);
  });

  it('returns the final seq of an emit made from inside a handler', () => {
    const bus = createBus({ clock: fakeClock() });
    let inner;
    bus.on('input.tap', () => { inner = bus.emit({ source: 'semantic', type: 'semantic.go', data: {} }); });
    bus.emit({ source: 'input', type: 'input.tap', data: {} });
    expect(inner.seq).toBe(1);
  });

  it('delivers every queued event even if a handler throws, then rethrows', () => {
    const bus = createBus({ clock: fakeClock() });
    bus.on('input.tap', () => { throw new Error('boom'); });
    const seen = collect(bus, 'page.focus');
    bus.on('input.tap', () => bus.emit(system('page.focus', { focused: true })));
    expect(() => bus.emit({ source: 'input', type: 'input.tap', data: {} })).toThrow('boom');
    expect(seen).toHaveLength(1);
    bus.emit(system('page.focus', { focused: false }));
    expect(seen.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('hands handler errors to onHandlerError when given', () => {
    const errors = [];
    const bus = createBus({ clock: fakeClock(), onHandlerError: (error, event) => errors.push([error.message, event.type]) });
    bus.on('*', () => { throw new Error('boom'); });
    bus.emit(system('page.focus', { focused: true }));
    expect(errors).toEqual([['boom', 'page.focus']]);
  });

  it('throws for events the validator rejects, without consuming a seq', () => {
    const bus = createBus({ clock: fakeClock(), validate: eventProblems });
    expect(() => bus.emit(system('page.focus', { focused: 'yes' }))).toThrow(/invalid page.focus event/);
    expect(bus.emit(system('page.focus', { focused: true })).seq).toBe(0);
  });
});

describe('typeMatches', () => {
  it.each([
    ['*', 'anything.here', true],
    ['input.*', 'input.tap', true],
    ['input.*', 'input.key.down', true],
    ['input.*', 'input', false],
    ['input.*', 'inputs.tap', false],
    ['input.tap', 'input.tap', true],
    ['input.tap', 'input.tap.x', false],
  ])('%s vs %s -> %s', (pattern, type, expected) => {
    expect(typeMatches(pattern, type)).toBe(expected);
  });
});

describe('contract with spec/', () => {
  it('knows the same event sources as the generated event schema', () => {
    expect(SOURCES).toEqual(eventSchema.properties.source.enum);
  });

  it('replays events.sample.jsonl through the bus unchanged, validating every event', () => {
    const lines = readFileSync(join(import.meta.dirname, '..', '..', 'spec', 'examples', 'events.sample.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const clock = fakeClock();
    const bus = createBus({ clock, validate: eventProblems });
    const replayed = collect(bus);
    for (const event of lines) {
      clock.time = event.t;
      bus.emit({ source: event.source, type: event.type, data: event.data, t: event.t, block: event.block, trial: event.trial, phase: event.phase, caused_by: event.caused_by });
    }
    expect(replayed).toEqual(lines);
    expect(replayed.map((e) => e.seq)).toEqual(lines.map((_, i) => i));
  });
});
