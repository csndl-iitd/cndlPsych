import { afterEach, describe, expect, it } from 'vitest';
import { createBus } from '../framework/foundation/events.js';
import { createClock } from '../framework/foundation/clock.js';
import { createSink } from '../framework/pipeline/sink.js';
import { createTriggers } from '../framework/pipeline/triggers.js';
import { createWebSocketTransport } from '../framework/pipeline/transports.js';
import { createVirtualSerialPair } from '../tools/virtual-serial.js';
import { eventProblems } from '../tools/validators.js';
import { startRelay } from './relay.js';

const cleanup = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); });

const until = async (check, timeout = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
};

async function startWith(options = {}) {
  const pair = createVirtualSerialPair();
  const logs = [];
  const relay = await startRelay({ port: 0, serial: { path: 'VIRTUAL', baud: 9600 }, openSerial: async (opened) => { pair.opened = opened; return pair.a; }, log: (l) => logs.push(l), ...options });
  cleanup.push(() => relay.close());
  return { relay, pair, logs, url: `ws://127.0.0.1:${relay.port}` };
}

const connect = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => resolve(ws);
  ws.onerror = () => reject(new Error('connection failed'));
  cleanup.push(async () => ws.close());
});

describe('relay: what reaches the serial port', () => {
  it('opens the port with the given path and baud rate', async () => {
    const { pair } = await startWith();
    expect(pair.opened).toEqual({ path: 'VIRTUAL', baudRate: 9600 });
  });

  it('binary frames are written as the same bytes', async () => {
    const { pair, url } = await startWith();
    const ws = await connect(url);
    ws.send(Uint8Array.of(0xaa, 31, 0x55));
    await until(() => pair.b.received.length === 3);
    expect(pair.b.received).toEqual([0xaa, 31, 0x55]);
  });

  it('text frames are written as UTF-8 text', async () => {
    const { pair, url } = await startWith();
    const ws = await connect(url);
    ws.send('T1f\r\n');
    await until(() => pair.b.received.length === 5);
    expect(pair.b.received).toEqual([...Buffer.from('T1f\r\n')]);
  });

  it('with --json-value, an ndjson line becomes one byte; other lines are refused and logged', async () => {
    const { pair, url, logs } = await startWith({ jsonValue: true });
    const ws = await connect(url);
    ws.send('{"seq":1,"value":31,"event":"phase.onset"}\n');
    ws.send('{"seq":2,"value":300}\n');
    ws.send('not json\n');
    ws.send('{"seq":4,"value":0}\n');
    await until(() => pair.b.received.length === 2);
    expect(pair.b.received).toEqual([31, 0]);
    expect(logs.filter((l) => l.startsWith('not written'))).toHaveLength(2);
  });
});

describe('relay: answers', () => {
  it('answers pings with its clock and writes nothing to the port', async () => {
    const { pair, url } = await startWith();
    const ws = await connect(url);
    const replies = [];
    ws.onmessage = (event) => replies.push(JSON.parse(event.data));
    const before = performance.timeOrigin + performance.now();
    ws.send(JSON.stringify({ ping: 7, t: 1 }));
    await until(() => replies.length === 1);
    expect(replies[0]).toMatchObject({ pong: 7 });
    expect(replies[0].t).toBeGreaterThanOrEqual(before);
    expect(replies[0].t).toBeLessThan(before + 5000);
    expect(pair.b.received).toEqual([]);
  });

  it('with --ack answers each written message, and not before it is written', async () => {
    const { pair, url, relay } = await startWith({ ack: true });
    const ws = await connect(url);
    const replies = [];
    ws.onmessage = (event) => replies.push(JSON.parse(event.data));
    ws.send(Uint8Array.of(1));
    ws.send(Uint8Array.of(2));
    await until(() => replies.length === 2);
    expect(replies.every((r) => r.ack === true && typeof r.t === 'number')).toBe(true);
    expect(pair.b.received).toEqual([1, 2]);
    expect(relay.writes).toBe(2);
  });

  it('without --ack sends no answers', async () => {
    const { pair, url } = await startWith();
    const ws = await connect(url);
    const replies = [];
    ws.onmessage = (event) => replies.push(event.data);
    ws.send(Uint8Array.of(1));
    await until(() => pair.b.received.length === 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(replies).toEqual([]);
  });

  it('serves several clients at once', async () => {
    const { pair, url } = await startWith();
    const [one, two] = [await connect(url), await connect(url)];
    one.send(Uint8Array.of(1));
    two.send(Uint8Array.of(2));
    await until(() => pair.b.received.length === 2);
    expect(pair.b.received.sort()).toEqual([1, 2]);
  });
});

describe('the framework websocket sink through the relay to a virtual serial pair', () => {
  function chain({ relayOptions, sinkConfig }) {
    return startWith(relayOptions).then(async ({ pair, url, relay }) => {
      const clock = createClock();
      const bus = createBus({ clock, validate: eventProblems });
      const events = [];
      bus.on('*', (e) => events.push(e));
      const transport = createWebSocketTransport({ url });
      const sink = createSink({ id: 'lab_ws', type: 'websocket', ...sinkConfig }, transport, {
        clock,
        report: { status: (state) => events.push({ type: 'sink.status', data: { state } }), sync: (s) => events.push({ type: 'sink.sync', data: s }) },
      });
      cleanup.push(() => sink.close());
      expect(await sink.connect()).toEqual({ ok: true });
      const triggers = createTriggers({ bus, clock, sinks: new Map([['lab_ws', sink]]) });
      return { pair, relay, bus, events, triggers, sink };
    });
  }

  it('format raw: a bus event becomes a byte on the port, with a template', async () => {
    const { pair, bus, events, triggers } = await chain({ sinkConfig: { format: 'raw', template: 'AA {value:02x} 55' } });
    triggers.setScope({ enabled: true, rules: [{ id: 'onset', on: 'phase.onset', where: { stimulus: 'search_array' }, value: 31 }] });
    const cause = bus.emit({ source: 'task', type: 'phase.onset', data: { phase: 'p', stimulus: 'search_array', planned_ms: null } });
    await until(() => pair.b.received.length === 3);
    expect(pair.b.received).toEqual([0xaa, 31, 0x55]);
    await until(() => events.some((e) => e.type === 'trigger.sent'));
    expect(events.find((e) => e.type === 'trigger.sent').data).toMatchObject({ sink: 'lab_ws', rule: 'onset', value: 31, event_seq: cause.seq, bytes: 3 });
  });

  it('format ndjson with --json-value: the value arrives as one byte', async () => {
    const { pair, bus, triggers } = await chain({ relayOptions: { jsonValue: true }, sinkConfig: { format: 'ndjson', fields: ['seq', 'value', 'event', 't_event', 't_sent'] } });
    triggers.setScope({ enabled: true, rules: [{ id: 'r', on: 'phase.onset', value: 22 }, { id: 'r2', on: 'phase.offset', value: 23 }] });
    bus.emit({ source: 'task', type: 'phase.onset', data: { phase: 'p', planned_ms: 1 } });
    bus.emit({ source: 'task', type: 'phase.offset', data: { phase: 'p', reason: 'duration' } });
    await until(() => pair.b.received.length === 2);
    expect(pair.b.received).toEqual([22, 23]);
  });

  it('ack: the sink records round trips as sink.sync', async () => {
    const { pair, bus, events, triggers } = await chain({ relayOptions: { ack: true, jsonValue: true }, sinkConfig: { format: 'ndjson', ack: true } });
    triggers.setScope({ enabled: true, rules: [{ id: 'r', on: 'phase.onset', value: 5 }] });
    bus.emit({ source: 'task', type: 'phase.onset', data: { phase: 'p', planned_ms: 1 } });
    await until(() => events.some((e) => e.type === 'sink.sync'));
    const sync = events.find((e) => e.type === 'sink.sync').data;
    expect(sync.offset_ms).toBeNull();
    expect(sync.rtt_ms).toBeGreaterThanOrEqual(0);
    expect(pair.b.received).toEqual([5]);
  });

  it('ping sync: offset_ms maps page time to the relay clock (relay time = t + offset; same machine, so the page time origin)', async () => {
    const { events } = await chain({ sinkConfig: { format: 'ndjson', sync: { pings: 3, interval_s: 60 } } });
    await until(() => events.some((e) => e.type === 'sink.sync'));
    const sync = events.find((e) => e.type === 'sink.sync').data;
    expect(sync.samples).toBe(3);
    expect(Math.abs(sync.offset_ms - performance.timeOrigin)).toBeLessThan(50);
    expect(sync.rtt_ms).toBeLessThan(500);
  });

  it('a relay that goes away makes the sink report disconnected', async () => {
    const { relay, events, sink } = await chain({ sinkConfig: { format: 'ndjson' } });
    await relay.close();
    await until(() => events.some((e) => e.type === 'sink.status' && e.data.state === 'disconnected'));
    expect(await sink.send({ value: 1, seq: 1 })).toMatchObject({ sent: false, reason: 'disconnected' });
  });
});
