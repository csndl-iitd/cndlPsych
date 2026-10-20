// A trigger sink: formats a message, queues it, and hands it to a transport (serial,
// websocket or USB). The queue enforces `min_gap_ms` between writes, `max_queue` bounds
// memory, `reset_after_ms` writes the reset byte after a raw pulse, and `ack` / `sync` measure
// round trips to a receiver that answers. Failures become `dropped` results with a reason,
// never exceptions into the bus.
import { schedule as defaultSchedule } from '../foundation/clock.js';
import { formatMessage } from '../foundation/format.js';

const DEFAULT_MAX_QUEUE = 256;
const PING_SPACING_MS = 20;
const encoder = new TextEncoder();

const byteLength = (message) => (typeof message === 'string' ? encoder.encode(message).length : message.length);
const sleep = (schedule, ms) => new Promise((resolve) => schedule(ms, resolve));

function parseJson(data) {
  if (typeof data !== 'string') return null;
  try { return JSON.parse(data); } catch { return null; }
}

/**
 * @param {object} config the sink from experiment.yaml (id, type, format, template, fields, ...)
 * @param {object} transport {connect, write, close, onMessage?, onClose?, onOpen?}
 * @param {{clock: {now: () => number}, schedule?: Function, defaults?: {min_gap_ms?: number}, report: {status: Function, sync: Function}}} options
 */
export function createSink(config, transport, { clock, schedule = defaultSchedule, defaults = {}, report }) {
  const minGap = config.min_gap_ms ?? defaults.min_gap_ms ?? 0;
  const maxQueue = config.max_queue ?? DEFAULT_MAX_QUEUE;
  const queue = [];
  const pendingAcks = [];
  const pings = new Map();
  let state = 'idle';
  let pumping = false;
  let idleWaiters = [];
  let lastWriteAt = -Infinity;
  let cancelReset = null;
  let cancelSync = null;
  let pingSamples = [];
  let nextPing = 0;

  function setState(next, detail) {
    state = next;
    report.status(next, detail);
  }

  function flush(reason) {
    for (const item of queue.splice(0)) item.resolve({ sent: false, reason });
  }

  // ---- receiving: pongs for sync, anything else is an acknowledgement ----------------
  function finishSyncRound() {
    const best = pingSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    report.sync({ offset_ms: best.offset, rtt_ms: best.rtt, samples: pingSamples.length });
    pingSamples = [];
    if (state === 'connected') cancelSync = schedule(config.sync.interval_s * 1000 || 60_000, runSyncRound);
  }

  function handlePong(message) {
    const sentAt = pings.get(message.pong);
    if (sentAt === undefined) return;
    pings.delete(message.pong);
    const rtt = clock.now() - sentAt;
    pingSamples.push({ rtt, offset: message.t - (sentAt + rtt / 2) });
    if (pingSamples.length >= (config.sync.pings ?? 10)) finishSyncRound();
  }

  function handleMessage(data) {
    const message = parseJson(data);
    if (message && 'pong' in message) {
      handlePong(message);
      return;
    }
    if (config.ack && pendingAcks.length) {
      report.sync({ offset_ms: null, rtt_ms: clock.now() - pendingAcks.shift(), samples: 1 });
    }
  }

  async function runSyncRound() {
    const count = config.sync.pings ?? 10;
    pingSamples = [];
    for (let i = 0; i < count && state === 'connected'; i += 1) {
      const id = nextPing;
      nextPing += 1;
      pings.set(id, clock.now());
      try {
        await transport.write(`${JSON.stringify({ ping: id, t: pings.get(id) })}\n`);
      } catch {
        return;
      }
      await sleep(schedule, PING_SPACING_MS);
    }
  }

  // ---- writing -------------------------------------------------------------------
  function scheduleReset() {
    cancelReset?.();
    cancelReset = null;
    if (config.format !== 'raw' || config.reset_after_ms === undefined) return;
    cancelReset = schedule(config.reset_after_ms, () => {
      cancelReset = null;
      queue.push({ fields: { value: config.reset_value ?? 0 }, internal: true, resolve() {} });
      pump();
    });
  }

  async function writeItem(item) {
    const tSent = clock.now();
    let message;
    try {
      message = formatMessage(config, { ...item.fields, t_sent: tSent });
    } catch (error) {
      item.resolve({ sent: false, reason: error instanceof RangeError ? 'out_of_range' : 'error', detail: error.message });
      return true;
    }
    try {
      await transport.write(message);
    } catch (error) {
      item.resolve({ sent: false, reason: 'disconnected', detail: error.message });
      setState('disconnected', error.message);
      flush('disconnected');
      return false;
    }
    lastWriteAt = tSent;
    if (config.ack && !item.internal) pendingAcks.push(tSent);
    item.resolve({ sent: true, bytes: byteLength(message), t_sent: tSent });
    if (!item.internal) scheduleReset();
    return true;
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    while (queue.length) {
      const wait = lastWriteAt + minGap - clock.now();
      if (wait > 0) await sleep(schedule, wait);
      if (!queue.length) break;
      if (!(await writeItem(queue.shift()))) break;
    }
    pumping = false;
    idleWaiters.splice(0).forEach((resolve) => resolve());
  }

  transport.onMessage?.(handleMessage);
  transport.onClose?.((detail) => {
    if (state === 'connected') setState('disconnected', detail);
    flush('disconnected');
  });
  transport.onOpen?.(() => {
    if (state === 'disconnected') setState('connected');
  });

  return {
    id: config.id,
    type: config.type,
    format: config.format,
    required: config.required !== false,
    get state() { return state; },
    get connected() { return state === 'connected'; },

    /** @returns {Promise<{ok: boolean, error?: string}>} */
    async connect() {
      setState('connecting');
      try {
        await transport.connect();
      } catch (error) {
        setState('error', error.message);
        return { ok: false, error: error.message };
      }
      setState('connected');
      if (config.sync) runSyncRound();
      return { ok: true };
    },

    /**
     * Queue a trigger. Resolves with {sent: true, bytes, t_sent} once written, or
     * {sent: false, reason} (queue_full | disconnected | out_of_range | error).
     * @param {object} fields trigger fields (value, seq, event, ...); t_sent is added at hand-off
     */
    send(fields) {
      if (state !== 'connected') return Promise.resolve({ sent: false, reason: 'disconnected' });
      if (queue.length >= maxQueue) return Promise.resolve({ sent: false, reason: 'queue_full' });
      cancelReset?.();
      cancelReset = null;
      return new Promise((resolve) => {
        queue.push({ fields, resolve });
        pump();
      });
    },

    /** Resolves when everything queued has been written (or dropped). */
    drain() {
      return queue.length || pumping ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve();
    },

    async close() {
      cancelReset?.();
      cancelSync?.();
      flush('disconnected');
      await transport.close();
      state = 'idle';
    },
  };
}
