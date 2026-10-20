import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeMessage, formatRecord, startListener } from './listen.js';

const cleanup = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); });

const until = async (check, timeout = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting');
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
};

async function start(options = {}) {
  const lines = [];
  const received = [];
  const listener = await startListener({ port: 0, log: (line) => lines.push(line), onTrigger: (record) => received.push(record), ...options });
  cleanup.push(() => listener.close());
  return { listener, lines, received, url: `ws://127.0.0.1:${listener.port}` };
}

const connect = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  const replies = [];
  ws.onmessage = (event) => replies.push(JSON.parse(event.data));
  ws.onopen = () => resolve({ ws, replies });
  ws.onerror = () => reject(new Error('connection failed'));
  cleanup.push(async () => ws.close());
});

describe('describeMessage and formatRecord', () => {
  it('reads an ndjson line, a binary frame and plain text', () => {
    expect(describeMessage('{"value":31,"event":"phase.onset","seq":7}\n', false)).toEqual({ value: 31, event: 'phase.onset', seq: 7 });
    expect(describeMessage(Buffer.from([0x1f, 0x00]), true)).toEqual({ value: 31, hex: '1f 00' });
    expect(describeMessage('AA 1f 55\n', false)).toEqual({ text: 'AA 1f 55' });
  });

  it('shows the time, the value, the event and the other fields on one line', () => {
    const line = formatRecord({ value: 7, event: 'input.key.up', rule: 'universal:key_up', seq: 12, t_event: 100.5, t_sent: 101.25, trial: 3 }, Date.UTC(2026, 9, 20, 8, 5, 3, 120));
    expect(line).toBe('08:05:03.120    7  input.key.up  rule=universal:key_up  seq=12  t_event=100.5  t_sent=101.25  trial=3');
    expect(formatRecord({ text: 'hello' }, Date.UTC(2026, 0, 1))).toContain('  -  text=hello');
  });
});

describe('the listener', () => {
  it('receives triggers from a websocket sink, shows each one and counts the values', async () => {
    const { listener, lines, received, url } = await start();
    const { ws } = await connect(url);
    ws.send('{"value":1,"event":"input.key.down","seq":0}\n');
    ws.send('{"value":31,"event":"phase.onset","seq":1,"stimulus":"search_array"}\n');
    ws.send('{"value":1,"event":"input.key.down","seq":2}\n');
    ws.send(Uint8Array.of(9));
    await until(() => received.length === 4);
    expect(received.map((record) => record.value)).toEqual([1, 31, 1, 9]);
    expect(lines.some((line) => line.includes('phase.onset') && line.includes('stimulus=search_array'))).toBe(true);
    expect([...listener.counts]).toEqual([[1, 2], [31, 1], [9, 1]]);
  });

  it('answers a ping with a pong, and every trigger with an ack only when asked to', async () => {
    const plain = await start();
    const first = await connect(plain.url);
    first.ws.send('{"ping":4,"t":10}\n');
    first.ws.send('{"value":2}\n');
    await until(() => plain.received.length === 1 && first.replies.length >= 1);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(first.replies).toHaveLength(1);
    expect(first.replies[0]).toMatchObject({ pong: 4 });
    expect(plain.received).toHaveLength(1); // the ping is not a trigger

    const acking = await start({ ack: true });
    const second = await connect(acking.url);
    second.ws.send('{"value":3}\n');
    await until(() => second.replies.length === 1);
    expect(second.replies[0]).toMatchObject({ ack: true });
  });

  it('writes a CSV with one row per trigger', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cndlpsych-listen-'));
    cleanup.push(async () => rmSync(dir, { recursive: true, force: true }));
    const csv = join(dir, 'triggers.csv');
    const { received, url } = await start({ csv });
    const { ws } = await connect(url);
    ws.send('{"value":11,"event":"bridge.key_injected","rule":"semantic:go","seq":5,"t_event":12.5,"t_sent":13,"trial":2}\n');
    await until(() => received.length === 1);
    const [header, row] = readFileSync(csv, 'utf8').trim().split('\r\n');
    expect(header).toBe('received_at,received_ms,value,event,rule,seq,t_event,t_sent,other');
    const cells = row.split(',');
    expect(cells.slice(2, 8)).toEqual(['11', 'bridge.key_injected', 'semantic:go', '5', '12.5', '13']);
    expect(row).toContain('"{""trial"":2}"');
  });
});
