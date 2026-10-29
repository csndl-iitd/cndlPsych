// Raw capture of a trigger device's traffic: every chunk of bytes received and written, with the time,
// uninterpreted, so the device and its formats can change without the app knowing. Chunks are kept in
// batches (about one per second) as {segment, index, chunks: [{sink, dir, t, n}], data}, where `data` holds
// the chunks' bytes one after another. The store that keeps them is handed in.
import { schedule as defaultSchedule } from '../foundation/clock.js';

const FLUSH_MS = 1000;

/** @param {{schedule?: Function, flushMs?: number, onError?: (error: Error) => void}} [options] */
export function createCapture({ schedule = defaultSchedule, flushMs = FLUSH_MS, onError } = {}) {
  const totals = new Map(); // sink id -> {rx_chunks, rx_bytes, tx_chunks, tx_bytes}
  let pending = [];
  let target = null;
  let segment = null;
  let index = 0;
  let cancelFlush = null;
  let chain = Promise.resolve();

  function pack(batch, segmentNumber, indexNumber) {
    const data = new Uint8Array(batch.reduce((sum, chunk) => sum + chunk.bytes.length, 0));
    let at = 0;
    for (const chunk of batch) {
      data.set(chunk.bytes, at);
      at += chunk.bytes.length;
    }
    return { segment: segmentNumber, index: indexNumber, chunks: batch.map(({ sink, dir, t, bytes }) => ({ sink, dir, t, n: bytes.length })), data };
  }

  function flush() {
    cancelFlush?.();
    cancelFlush = null;
    if (!target || pending.length === 0) return chain;
    const batch = pending;
    pending = [];
    chain = chain.then(async () => {
      try {
        await target.addStream(pack(batch, await segment, index++));
      } catch (error) {
        onError?.(error);
      }
    });
    return chain;
  }

  return {
    /** @param {{sink: string, dir: 'rx'|'tx', t: number, bytes: Uint8Array}} chunk */
    add(chunk) {
      const total = totals.get(chunk.sink) ?? { rx_chunks: 0, rx_bytes: 0, tx_chunks: 0, tx_bytes: 0 };
      total[`${chunk.dir}_chunks`] += 1;
      total[`${chunk.dir}_bytes`] += chunk.bytes.length;
      totals.set(chunk.sink, total);
      pending.push(chunk);
      if (target && !cancelFlush) cancelFlush = schedule(flushMs, flush);
    },

    /** Start keeping chunks in this store (what arrived before is written now). A resumed session starts a new segment. */
    attach(store) {
      if (typeof store.addStream !== 'function') return;
      target = store;
      segment = Promise.resolve(store.nextStreamSegment?.() ?? 1);
      if (pending.length) cancelFlush = schedule(flushMs, flush);
    },

    flush,
    totals: (sink) => totals.get(sink),
  };
}
