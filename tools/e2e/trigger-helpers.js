// Helpers for trigger tests: a fake Web Serial device in the page, a relay with a virtual
// serial pair in the test process, and the example's sinks pointed at that relay.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { startRelay } from '../../cli/relay.js';
import { createVirtualSerialPair } from '../virtual-serial.js';

const EXAMPLE = join(import.meta.dirname, '..', '..', 'spec', 'examples', 'experiment.yaml');
export const exampleSinks = () => load(readFileSync(EXAMPLE, 'utf8')).triggers.sinks;

/**
 * Replace navigator.serial before the page loads. requestPort rejects `rejectPicks` times
 * first (the user closed the picker); writes are recorded in window.__serial.writes and
 * start failing after `failAfter` writes (the cable was pulled).
 */
export function installFakeSerial(page, { rejectPicks = 0, failAfter = null } = {}) {
  return page.addInitScript(({ rejects, fail }) => {
    const state = { writes: [], picks: 0, opened: null, rejects, fail };
    window.__serial = state;
    const port = {
      open: async (options) => { state.opened = options; },
      writable: { getWriter: () => ({
        write: async (data) => {
          if (state.fail !== null && state.writes.length >= state.fail) throw new Error('device unplugged');
          state.writes.push([...data]);
        },
        releaseLock() {},
      }) },
      close: async () => {},
    };
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => { state.picks += 1; if (state.picks <= state.rejects) throw new Error('No port selected by the user.'); return port; } },
    });
  }, { rejects: rejectPicks, fail: failAfter });
}

export const serialWrites = (page) => page.evaluate(() => window.__serial.writes);

/** A relay on a port that is unique per Playwright worker, bridging to a virtual serial pair. */
export async function startTestRelay(testInfo, options = {}) {
  const pair = createVirtualSerialPair();
  const port = 18_765 + testInfo.parallelIndex;
  const relay = await startRelay({ port, host: '127.0.0.1', serial: { path: 'VIRTUAL' }, openSerial: async () => pair.a, jsonValue: true, ack: true, ...options });
  return { relay, pair, port };
}

/** experiment.yaml merge: the example's sinks with the websocket pointed at the relay's port. */
export function sinksMerge(port) {
  return { triggers: { sinks: exampleSinks().map((sink) => (sink.type === 'websocket' ? { ...sink, url: `ws://127.0.0.1:${port}` } : sink)) } };
}

/**
 * Replace navigator.usb before the page loads with a CDC-ACM serial device that streams a text line every 20 ms and
 * answers each byte written with a line "ECHO <hex>". Writes are recorded in window.__usb.writes.
 */
export function installFakeUsb(page) {
  return page.addInitScript(() => {
    const state = { writes: [], line: [], control: [] };
    window.__usb = state;
    const waiting = [];
    const queued = [];
    const bytesOf = (text) => new TextEncoder().encode(text);
    const deliver = (bytes) => (waiting.length ? waiting.shift()({ status: 'ok', data: new DataView(bytes.buffer) }) : queued.push(bytes));
    let count = 0;
    setInterval(() => { count += 1; deliver(bytesOf(`${(count & 0xffff).toString(16).toUpperCase().padStart(4, '0')}7FF\n`)); }, 20);
    const device = {
      configuration: { interfaces: [
        { interfaceNumber: 0, alternates: [{ interfaceClass: 0x02, endpoints: [] }] },
        { interfaceNumber: 1, alternates: [{ interfaceClass: 0x0a, endpoints: [{ endpointNumber: 1, direction: 'out', type: 'bulk' }, { endpointNumber: 2, direction: 'in', type: 'bulk' }] }] },
      ] },
      open: async () => {},
      claimInterface: async () => {},
      controlTransferOut: async (setup) => { state.control.push(setup.request); return { status: 'ok' }; },
      transferIn: () => new Promise((resolve) => { if (queued.length) resolve({ status: 'ok', data: new DataView(queued.shift().buffer) }); else waiting.push(resolve); }),
      transferOut: async (endpoint, data) => {
        state.writes.push([...data]);
        deliver(bytesOf(`ECHO ${[...data].map((byte) => byte.toString(16).padStart(2, '0')).join('')}\n`));
        return { status: 'ok' };
      },
      close: async () => {},
    };
    Object.defineProperty(navigator, 'usb', { configurable: true, value: { requestDevice: async () => device } });
  });
}
