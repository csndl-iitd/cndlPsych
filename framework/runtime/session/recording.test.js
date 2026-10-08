import { describe, expect, it } from 'vitest';
import { connectStore, emitStartNotices, logStorageStatus } from './recording.js';

const busWith = () => {
  const handlers = [];
  const emitted = [];
  return { handlers, emitted, on: (type, handler) => handlers.push([type, handler]), emit: (event) => emitted.push(event) };
};

describe('connectStore', () => {
  it('appends every bus event to the store and flushes when the page is left', () => {
    const bus = busWith();
    const leave = [];
    const store = { appended: [], flushes: 0, append(event) { this.appended.push(event); }, flush() { this.flushes += 1; } };
    connectStore({ services: { bus, input: { onLeave: (handler) => leave.push(handler) } }, store });
    expect(bus.handlers.map(([type]) => type)).toEqual(['*']);
    bus.handlers[0][1]({ seq: 0 });
    leave[0]();
    expect(store.appended).toEqual([{ seq: 0 }]);
    expect(store.flushes).toBe(1);
  });
});

describe('logStorageStatus', () => {
  it('logs the store statuses as storage.status, except closed, which would come after the last counted event', () => {
    const bus = busWith();
    let report;
    logStorageStatus({ bus, store: { onStatus: (handler) => { report = handler; } } });
    report({ state: 'opening' });
    report({ state: 'ready' });
    report({ state: 'closed' });
    report({ sink: 'firebase', state: 'degraded', detail: 'offline' });
    expect(bus.emitted.map((e) => e.data)).toEqual([{ sink: 'local', state: 'opening' }, { sink: 'local', state: 'ready' }, { sink: 'firebase', state: 'degraded', detail: 'offline' }]);
    expect(bus.emitted.every((e) => e.source === 'storage' && e.type === 'storage.status')).toBe(true);
  });

  it('copes with a store that has no statuses (the in-memory store)', () => {
    expect(() => logStorageStatus({ bus: busWith(), store: {} })).not.toThrow();
  });
});

describe('emitStartNotices', () => {
  const sinkSet = () => ({ flushed: 0, flushBacklog() { this.flushed += 1; } });

  it('flushes the sink events collected before recording, and warns about scaled time and skipped sinks', () => {
    const bus = busWith();
    const sinks = sinkSet();
    emitStartNotices({ bus, debug: { time_scale: 0.2 }, sinkSet: sinks, sinkWarnings: [{ id: 'lab_ws', error: 'refused' }] });
    expect(sinks.flushed).toBe(1);
    expect(bus.emitted.map((e) => e.data.code)).toEqual(['debug_time_scale', 'sink_unavailable']);
    expect(bus.emitted[1].data).toMatchObject({ detail: { sink: 'lab_ws' } });
  });

  it('says nothing when time is not scaled and every sink connected', () => {
    const bus = busWith();
    emitStartNotices({ bus, debug: {}, sinkSet: sinkSet(), sinkWarnings: [] });
    emitStartNotices({ bus, debug: { time_scale: 1 }, sinkSet: sinkSet(), sinkWarnings: [] });
    expect(bus.emitted).toEqual([]);
  });
});
