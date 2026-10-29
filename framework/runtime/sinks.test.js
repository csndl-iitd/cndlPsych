import { describe, expect, it } from 'vitest';
import { createFakeTime } from '../../tools/fake-time.js';
import { createMemoryStore } from './memory-store.js';
import { createSinks } from './sinks.js';

const ANDROID = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', platform: 'Linux armv81', maxTouchPoints: 5 };

function fakeSerial() {
  const log = { writes: [] };
  let wake = null;
  const port = {
    open: async () => {},
    writable: { getWriter: () => ({ write: async (data) => { log.writes.push([...data]); }, releaseLock() {} }) },
    readable: { getReader: () => ({ read: () => new Promise((resolve) => { wake = resolve; }), cancel: async () => { wake?.({ done: true }); } }) },
    close: async () => {},
  };
  return { log, push: (bytes) => wake({ value: Uint8Array.from(bytes), done: false }), api: { requestPort: async () => port } };
}

function fakeUsb() {
  const log = { out: [] };
  const waiting = [];
  const device = {
    configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 0x0a, endpoints: [{ endpointNumber: 1, direction: 'out', type: 'bulk' }, { endpointNumber: 2, direction: 'in', type: 'bulk' }] }] }] },
    open: async () => {},
    claimInterface: async () => {},
    controlTransferOut: async () => ({ status: 'ok' }),
    transferIn: () => new Promise((resolve) => { waiting.push(resolve); }),
    transferOut: async (ep, data) => { log.out.push([...data]); return { status: 'ok' }; },
    close: async () => {},
  };
  return { log, push: (bytes) => waiting.shift()({ status: 'ok', data: new DataView(Uint8Array.from(bytes).buffer) }), api: { requestDevice: async () => device } };
}

function setup({ navigator, apis, sink = {} }) {
  const time = createFakeTime();
  const events = [];
  const bus = { recording: true, emit: (event) => events.push(event) };
  const plan = { triggers: { sinks: [{ id: 'rx', type: 'serial', format: 'raw', capture: { raw: true }, ...sink }] } };
  const previous = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: navigator, configurable: true });
  const sinkSet = createSinks({ plan, bus, clock: time.clock, schedule: time.schedule, apis });
  Object.defineProperty(globalThis, 'navigator', { value: previous, configurable: true });
  return { sinkSet, time, events, sink: sinkSet.sinks.get('rx') };
}

describe('a serial sink', () => {
  it('uses Web Serial on a computer', async () => {
    const serial = fakeSerial();
    const { sink, sinkSet } = setup({ navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', platform: 'Win32', maxTouchPoints: 0 }, apis: { serial: serial.api, usb: fakeUsb().api } });
    expect(await sink.connect()).toEqual({ ok: true });
    await sink.send({ value: 3 });
    expect(serial.log.writes).toEqual([[3]]);
    expect(sinkSet.record()[0]).toMatchObject({ id: 'rx', transport: 'serial', connected: true });
  });

  it('uses WebUSB (CDC-ACM) on an Android phone, where the browser has no Web Serial', async () => {
    const usb = fakeUsb();
    const { sink, sinkSet } = setup({ navigator: ANDROID, apis: { usb: usb.api } });
    expect(await sink.connect()).toEqual({ ok: true });
    await sink.send({ value: 4 });
    expect(usb.log.out).toEqual([[4]]);
    expect(sinkSet.record()[0]).toMatchObject({ transport: 'webusb', connected: true });
  });

  it('fails to connect, with a reason an experimenter can act on, when the phone has neither', async () => {
    const { sink } = setup({ navigator: ANDROID, apis: {} });
    const result = await sink.connect();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Web Serial is not available');
  });
});

describe('raw capture in the sink set', () => {
  it('keeps what the device sent and what was written, in the session store, and counts it in the record', async () => {
    const usb = fakeUsb();
    const { sink, sinkSet, time } = setup({ navigator: ANDROID, apis: { usb: usb.api } });
    const store = createMemoryStore();
    sinkSet.attachStore(store);
    await sink.connect();
    time.now = 20;
    usb.push([0x31, 0x41, 0x0a]);
    await time.settle();
    time.now = 25;
    await sink.send({ value: 9 });
    await sinkSet.drain();
    expect(await store.readStreams()).toEqual([{ segment: 1, index: 0, chunks: [{ sink: 'rx', dir: 'rx', t: 20, n: 3 }, { sink: 'rx', dir: 'tx', t: 25, n: 1 }], data: Uint8Array.from([0x31, 0x41, 0x0a, 9]) }]);
    expect(sinkSet.record()[0].capture).toEqual({ rx_chunks: 1, rx_bytes: 3, tx_chunks: 1, tx_bytes: 1 });
  });

  it('keeps nothing and records nothing when the sink does not ask for it', async () => {
    const usb = fakeUsb();
    const { sink, sinkSet, time } = setup({ navigator: ANDROID, apis: { usb: usb.api }, sink: { capture: undefined } });
    const store = createMemoryStore();
    sinkSet.attachStore(store);
    await sink.connect();
    usb.push([1]);
    await time.settle();
    await sinkSet.drain();
    expect(await store.readStreams()).toEqual([]);
    expect(sinkSet.record()[0].capture).toBeUndefined();
  });
});
