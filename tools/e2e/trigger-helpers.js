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
