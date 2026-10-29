import { describe, expect, it } from 'vitest';
import { createFakeTime } from '../../tools/fake-time.js';
import { createSink } from './sink.js';

function setup(config, { transportOverrides = {}, defaults } = {}) {
  const time = createFakeTime();
  const writes = [];
  const statuses = [];
  const syncs = [];
  const captures = [];
  const handlers = {};
  const transport = {
    connect: async () => {},
    write: async (data) => { writes.push({ data, at: time.now }); },
    close: async () => {},
    onMessage: (h) => { handlers.message = h; },
    onData: (h) => { handlers.data = h; },
    onClose: (h) => { handlers.close = h; },
    onOpen: (h) => { handlers.open = h; },
    ...transportOverrides,
  };
  const sink = createSink({ id: 's', type: 'serial', format: 'raw', ...config }, transport, {
    clock: time.clock, schedule: time.schedule, defaults,
    report: { status: (state, detail) => statuses.push([state, detail]), sync: (s) => syncs.push(s), capture: (c) => captures.push(c) },
  });
  return { sink, time, writes, statuses, syncs, captures, handlers, bytes: () => writes.map((w) => [...w.data]) };
}

describe('connecting', () => {
  it('reports connecting then connected, and drops sends before connect', async () => {
    const t = setup({});
    expect(await t.sink.send({ value: 1 })).toEqual({ sent: false, reason: 'disconnected' });
    expect(await t.sink.connect()).toEqual({ ok: true });
    expect(t.statuses).toEqual([['connecting', undefined], ['connected', undefined]]);
    expect(t.sink.connected).toBe(true);
  });

  it('reports a failed connection with the reason', async () => {
    const t = setup({}, { transportOverrides: { connect: async () => { throw new Error('port busy'); } } });
    expect(await t.sink.connect()).toEqual({ ok: false, error: 'port busy' });
    expect(t.statuses.at(-1)).toEqual(['error', 'port busy']);
    expect(t.sink.connected).toBe(false);
  });

  it('exposes id, type, format and requiredness (default true)', () => {
    expect(setup({ id: 'eeg', required: false }).sink).toMatchObject({ id: 'eeg', type: 'serial', format: 'raw', required: false });
    expect(setup({}).sink.required).toBe(true);
  });
});

describe('raw sinks: exact bytes', () => {
  it.each([
    [{}, 21, [[21]]],
    [{ template: '{value:02x}' }, 31, [[31]]],
    [{ template: 'AA {value:02x} 55' }, 10, [[0xaa, 10, 0x55]]],
    [{ template: '{value:02x}' }, 255, [[255]]],
    [{ template: '{value:02x}' }, 0, [[0]]],
  ])('%j value %d -> %j', async (config, value, expected) => {
    const t = setup(config);
    await t.sink.connect();
    const outcome = await t.sink.send({ value });
    expect(outcome).toMatchObject({ sent: true, bytes: expected[0].length });
    expect(t.bytes()).toEqual(expected);
  });

  it('writes the reset byte after reset_after_ms, through the same template', async () => {
    const t = setup({ template: 'AA {value:02x} 55', reset_after_ms: 5 });
    await t.sink.connect();
    await t.sink.send({ value: 7 });
    await t.time.advance(4);
    expect(t.bytes()).toEqual([[0xaa, 7, 0x55]]);
    await t.time.advance(1);
    expect(t.bytes()).toEqual([[0xaa, 7, 0x55], [0xaa, 0, 0x55]]);
    expect(t.writes[1].at).toBe(5);
  });

  it('uses reset_value when given, and a new trigger cancels the pending reset', async () => {
    const t = setup({ reset_after_ms: 5, reset_value: 255 });
    await t.sink.connect();
    await t.sink.send({ value: 1 });
    await t.time.advance(3);
    await t.sink.send({ value: 2 });
    await t.time.advance(4);
    expect(t.bytes()).toEqual([[1], [2]]);
    await t.time.advance(1);
    expect(t.bytes()).toEqual([[1], [2], [255]]);
  });

  it('drops a value that does not fit a byte as out_of_range, without writing', async () => {
    const t = setup({});
    await t.sink.connect();
    expect(await t.sink.send({ value: 300 })).toMatchObject({ sent: false, reason: 'out_of_range' });
    expect(t.writes).toEqual([]);
  });

  it('does not write a reset for text formats', async () => {
    const t = setup({ format: 'ndjson', reset_after_ms: 5 });
    await t.sink.connect();
    await t.sink.send({ value: 1, seq: 1 });
    await t.time.advance(50);
    expect(t.writes).toHaveLength(1);
  });
});

describe('text sinks', () => {
  it('ndjson: the selected fields plus the hand-off time, one line', async () => {
    const t = setup({ format: 'ndjson', fields: ['seq', 'value', 't_event', 't_sent'] });
    await t.sink.connect();
    t.time.now = 40;
    await t.sink.send({ seq: 3, value: 9, t_event: 38.5 });
    expect(t.writes[0].data).toBe('{"seq":3,"value":9,"t_event":38.5,"t_sent":40}\n');
  });

  it('template: substitution and newline', async () => {
    const t = setup({ format: 'template', template: 'T{value:02x}', newline: 'crlf' });
    await t.sink.connect();
    expect(await t.sink.send({ value: 26 })).toMatchObject({ sent: true, bytes: 5 });
    expect(t.writes[0].data).toBe('T1a\r\n');
  });

  it('counts bytes of non-ASCII text, not characters', async () => {
    const t = setup({ format: 'template', template: '{stimulus}', newline: 'none' });
    await t.sink.connect();
    expect(await t.sink.send({ value: 1, stimulus: 'oddball_Ǝ' })).toMatchObject({ bytes: 'oddball_Ǝ'.length + 1 });
  });
});

describe('queue', () => {
  it('keeps min_gap_ms between writes (config, or the experiment default)', async () => {
    for (const setupArgs of [[{ min_gap_ms: 10 }, {}], [{}, { defaults: { min_gap_ms: 10 } }]]) {
      const t = setup(...setupArgs);
      await t.sink.connect();
      const results = [t.sink.send({ value: 1 }), t.sink.send({ value: 2 }), t.sink.send({ value: 3 })];
      await t.time.advance(100);
      expect((await Promise.all(results)).every((r) => r.sent)).toBe(true);
      expect(t.writes.map((w) => w.at)).toEqual([0, 10, 20]);
    }
  });

  it('writes in order and reports t_sent at the hand-off, not at queue time', async () => {
    const t = setup({ min_gap_ms: 10 });
    await t.sink.connect();
    const first = t.sink.send({ value: 1 });
    const second = t.sink.send({ value: 2 });
    await t.time.advance(30);
    expect((await first).t_sent).toBe(0);
    expect((await second).t_sent).toBe(10);
  });

  it('drops when the queue is full (max_queue)', async () => {
    const t = setup({ max_queue: 2 }, { transportOverrides: { write: () => new Promise(() => {}) } });
    await t.sink.connect();
    t.sink.send({ value: 1 });
    await t.time.settle();
    t.sink.send({ value: 2 });
    t.sink.send({ value: 3 });
    expect(await t.sink.send({ value: 4 })).toEqual({ sent: false, reason: 'queue_full' });
  });

  it('a failing write marks the sink disconnected and drops what was queued', async () => {
    let fail = false;
    const t = setup({ min_gap_ms: 10 }, { transportOverrides: { write: async (d) => { if (fail) throw new Error('unplugged'); t.writes.push({ data: d, at: t.time.now }); } } });
    await t.sink.connect();
    expect((await t.sink.send({ value: 1 })).sent).toBe(true);
    fail = true;
    const a = t.sink.send({ value: 2 });
    const b = t.sink.send({ value: 3 });
    await t.time.advance(50);
    expect(await a).toMatchObject({ sent: false, reason: 'disconnected' });
    expect(await b).toEqual({ sent: false, reason: 'disconnected' });
    expect(t.statuses.at(-1)).toEqual(['disconnected', 'unplugged']);
    expect(await t.sink.send({ value: 4 })).toEqual({ sent: false, reason: 'disconnected' });
  });

  it('a transport close drops the queue; reopening reconnects', async () => {
    const t = setup({});
    await t.sink.connect();
    t.handlers.close('connection closed');
    expect(t.sink.state).toBe('disconnected');
    expect(await t.sink.send({ value: 1 })).toEqual({ sent: false, reason: 'disconnected' });
    t.handlers.open();
    expect(t.sink.state).toBe('connected');
    expect((await t.sink.send({ value: 1 })).sent).toBe(true);
  });
});

describe('ack round trips', () => {
  it('reports one sink.sync per answer, in send order, with no clock offset', async () => {
    const t = setup({ ack: true });
    await t.sink.connect();
    await t.sink.send({ value: 1 });
    t.time.now = 4;
    await t.sink.send({ value: 2 });
    t.time.now = 10;
    t.handlers.message('ok');
    t.time.now = 12;
    t.handlers.message('ok');
    expect(t.syncs).toEqual([{ offset_ms: null, rtt_ms: 10, samples: 1 }, { offset_ms: null, rtt_ms: 8, samples: 1 }]);
  });

  it('ignores answers when ack is off, and stray answers with nothing pending', async () => {
    const off = setup({});
    await off.sink.connect();
    await off.sink.send({ value: 1 });
    off.handlers.message('x');
    expect(off.syncs).toEqual([]);
    const on = setup({ ack: true });
    await on.sink.connect();
    on.handlers.message('stray');
    expect(on.syncs).toEqual([]);
  });
});

describe('ping sync', () => {
  it('estimates the receiver clock offset from the quickest round trip', async () => {
    const t = setup({ type: 'websocket', format: 'ndjson', sync: { pings: 3, interval_s: 60 } });
    // The receiver's clock runs 500 ms ahead; answers take different times.
    const delays = [30, 8, 20];
    t.sink.connect();
    let answered = 0;
    const origWrite = t.writes;
    await t.time.settle();
    for (let i = 0; i < 3; i += 1) {
      await t.time.advance(i === 0 ? 0 : 20);
      const ping = JSON.parse(origWrite[i].data);
      const sentAt = ping.t;
      t.time.now = sentAt + delays[i];
      t.handlers.message(JSON.stringify({ pong: ping.ping, t: sentAt + delays[i] / 2 + 500 }));
      answered += 1;
    }
    expect(answered).toBe(3);
    expect(t.syncs).toHaveLength(1);
    expect(t.syncs[0].samples).toBe(3);
    expect(t.syncs[0].rtt_ms).toBe(8);
    expect(t.syncs[0].offset_ms).toBeCloseTo(500, 5);
  });

  it('repeats every interval_s while connected', async () => {
    const t = setup({ type: 'websocket', format: 'ndjson', sync: { pings: 1, interval_s: 10 } });
    await t.sink.connect();
    const answer = () => {
      const ping = JSON.parse(t.writes.at(-1).data);
      t.handlers.message(JSON.stringify({ pong: ping.ping, t: ping.t }));
    };
    await t.time.advance(0);
    answer();
    expect(t.syncs).toHaveLength(1);
    await t.time.advance(10_000);
    answer();
    expect(t.syncs).toHaveLength(2);
  });

  it('does not mistake a pong for an acknowledgement', async () => {
    const t = setup({ type: 'websocket', format: 'ndjson', ack: true, sync: { pings: 1 } });
    await t.sink.connect();
    await t.sink.send({ value: 1, seq: 1 });
    await t.time.advance(0);
    const ping = JSON.parse(t.writes.find((w) => w.data.includes('"ping"')).data);
    t.handlers.message(JSON.stringify({ pong: ping.ping, t: ping.t }));
    expect(t.syncs).toHaveLength(1);
    expect(t.syncs[0].offset_ms).not.toBeNull();
    t.handlers.message('ack');
    expect(t.syncs[1]).toMatchObject({ offset_ms: null });
  });
});

describe('close', () => {
  it('drops queued triggers and closes the transport', async () => {
    let closed = false;
    const t = setup({ min_gap_ms: 100 }, { transportOverrides: { close: async () => { closed = true; } } });
    await t.sink.connect();
    t.sink.send({ value: 1 });
    const pending = t.sink.send({ value: 2 });
    await t.sink.close();
    expect(await pending).toEqual({ sent: false, reason: 'disconnected' });
    expect(closed).toBe(true);
    expect(t.sink.state).toBe('idle');
  });
});

describe('raw capture', () => {
  it('hands every received chunk and every written message on, uninterpreted, with the time', async () => {
    const t = setup({ capture: { raw: true } });
    await t.sink.connect();
    t.time.now = 5;
    t.handlers.data(Uint8Array.from([0x31, 0x41, 0x0a]));
    t.time.now = 8;
    expect(await t.sink.send({ value: 17 })).toMatchObject({ sent: true });
    expect(t.captures).toEqual([
      { dir: 'rx', t: 5, bytes: Uint8Array.from([0x31, 0x41, 0x0a]) },
      { dir: 'tx', t: 8, bytes: Uint8Array.from([17]) },
    ]);
  });

  it('turns text into bytes, and does nothing unless it is asked to', async () => {
    const text = setup({ format: 'template', template: 'T{value}', newline: 'lf', capture: { raw: true } });
    await text.sink.connect();
    await text.sink.send({ value: 5 });
    expect(text.captures[0].bytes).toEqual(new TextEncoder().encode('T5\n'));

    const off = setup({});
    await off.sink.connect();
    expect(off.handlers.data).toBeUndefined();
    await off.sink.send({ value: 1 });
    expect(off.captures).toEqual([]);
  });
});
