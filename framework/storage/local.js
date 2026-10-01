// The local log: every event goes to IndexedDB as it happens, so an interrupted session
// can be recovered. This is the only module that touches IndexedDB (hard rule 3).
//
// Writes are buffered and flushed every `flushMs` (and when the page is hidden, via
// flush()). Each flush is one transaction that also advances the session's `last_seq`, so
// what is on disk is always a gap-free prefix 0..last_seq of the log: a crash loses at most
// the events since the last flush, never a hole in the middle.
//
// If IndexedDB is unavailable (some private modes) or a write fails, the store degrades to
// memory: the session carries on, exports still work, and `storage.status` says so.
import { schedule as defaultSchedule } from '../foundation/clock.js';

const VERSION = 1;
const MAX_BUFFER = 200;
const SESSIONS = 'sessions';
const EVENTS = 'events';

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * @param {{indexedDB?: IDBFactory, IDBKeyRange?: object, flushMs?: number, schedule?: Function, dbName?: string, now?: () => string}} [options]
 */
export function createLocalStore({
  indexedDB = globalThis.indexedDB, IDBKeyRange = globalThis.IDBKeyRange, flushMs = 2000, schedule = defaultSchedule,
  dbName = 'expfw', now = () => new Date().toISOString(),
} = {}) {
  let db = null;
  let session = null; // {key, record}
  let buffer = [];
  let memory = [];
  let lastSeq = -1;
  let degraded = false;
  let cancelFlush = null;
  let chain = Promise.resolve();
  let opening = null;
  const statuses = [];
  const statusHandlers = [];

  function setStatus(state, detail) {
    const status = { state, ...(detail ? { detail } : {}) };
    statuses.push(status);
    statusHandlers.forEach((handler) => handler(status));
  }

  function degrade(error) {
    if (degraded) return;
    degraded = true;
    setStatus('degraded', `${error?.message ?? error}; events are kept in memory only`);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!indexedDB) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = indexedDB.open(dbName, VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(SESSIONS, { keyPath: 'key' });
        req.result.createObjectStore(EVENTS, { keyPath: ['session', 'seq'] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('the database is blocked by another tab'));
    });
  }

  /** Open lazily; a store that is only asked about old sessions must not create the database. */
  async function ready() {
    opening ??= openDatabase().then((opened) => { db = opened; }, degrade);
    await opening;
    return db;
  }

  async function exists() {
    if (!indexedDB) return false;
    if (typeof indexedDB.databases !== 'function') return true;
    return (await indexedDB.databases()).some((info) => info.name === dbName);
  }

  async function work(stores, mode, fn) {
    const tx = db.transaction(stores, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
    const result = await fn(...stores.map((name) => tx.objectStore(name)));
    await done;
    return result;
  }

  const range = (key) => IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);

  async function writeBatch(batch) {
    if (degraded || !db) return;
    try {
      await work([SESSIONS, EVENTS], 'readwrite', async (sessions, events) => {
        for (const event of batch) events.put({ session: session.key, seq: event.seq, event });
        const stored = await request(sessions.get(session.key));
        sessions.put({ ...stored, last_seq: batch.at(-1).seq, updated_at: now() });
      });
    } catch (error) {
      degrade(error);
    }
  }

  function flush() {
    cancelFlush?.();
    cancelFlush = null;
    const batch = buffer.splice(0);
    if (batch.length) chain = chain.then(() => writeBatch(batch));
    return chain;
  }

  function arm() {
    if (cancelFlush || flushMs <= 0) return;
    cancelFlush = schedule(flushMs, () => { cancelFlush = null; flush(); });
  }

  async function putSession(fields) {
    if (degraded || !db) return;
    try {
      await work([SESSIONS], 'readwrite', async (sessions) => {
        const stored = await request(sessions.get(session.key));
        sessions.put({ ...stored, ...fields, key: session.key, updated_at: now() });
      });
    } catch (error) {
      degrade(error);
    }
  }

  const store = {
    /** Subscribe to storage.status changes; earlier statuses are replayed. */
    onStatus(handler) {
      statusHandlers.push(handler);
      statuses.forEach(handler);
    },

    /** Recording started: create the session. Call only after consent (nothing exists before). */
    begin(record) {
      session = { key: `${record.subject_id}_${record.session_id}_${record.started_at}`, record };
      setStatus('opening');
      chain = chain.then(async () => {
        await ready();
        if (!degraded) {
          await work([SESSIONS], 'readwrite', async (sessions) => {
            sessions.put({ key: session.key, record, status: 'in_progress', last_seq: -1, started_at: record.started_at, updated_at: now() });
          }).catch(degrade);
        }
        if (!degraded) setStatus('ready');
      });
    },

    append(event) {
      buffer.push(event);
      memory.push(event);
      lastSeq = event.seq;
      if (buffer.length >= MAX_BUFFER) flush();
      else arm();
    },

    flush,

    /** The session ended: write what is left and mark it finished. */
    async finish(record) {
      session.record = record;
      await flush();
      await (chain = chain.then(() => putSession({ record, status: 'finished', last_seq: lastSeq })));
      setStatus('closed');
    },

    /** The record and every event so far, from disk (or memory when degraded). */
    async snapshot() {
      await flush();
      if (degraded || !db) return { record: session.record, events: [...memory] };
      const stored = await work([EVENTS], 'readonly', (events) => request(events.getAll(range(session.key))));
      return { record: session.record, events: stored.map((row) => row.event) };
    },

    // ---- recovery of earlier sessions ------------------------------------------------------
    /** Sessions that were still in progress when the page went away. */
    async findUnfinished() {
      if (!(await exists())) return [];
      await ready();
      if (!db) return [];
      return work([SESSIONS], 'readonly', async (sessions) => (await request(sessions.getAll()))
        .filter((row) => row.status === 'in_progress')
        .map((row) => ({ key: row.key, record: row.record, lastSeq: row.last_seq, updatedAt: row.updated_at })));
    },

    /** @returns {Promise<{record: object, events: object[]}|null>} */
    async read(key) {
      await ready();
      if (!db) return null;
      return work([SESSIONS, EVENTS], 'readonly', async (sessions, events) => {
        const row = await request(sessions.get(key));
        if (!row) return null;
        return { record: row.record, events: (await request(events.getAll(range(key)))).map((r) => r.event) };
      });
    },

    /** Close an interrupted session as aborted, with its real last_seq; returns the final record. */
    async abandon(key) {
      await ready();
      return work([SESSIONS], 'readwrite', async (sessions) => {
        const row = await request(sessions.get(key));
        const record = { ...row.record, status: 'aborted', end_reason: 'aborted', ended_at: row.updated_at, last_seq: row.last_seq };
        sessions.put({ ...row, record, status: 'aborted' });
        return record;
      });
    },

    async remove(key) {
      await ready();
      await work([SESSIONS, EVENTS], 'readwrite', async (sessions, events) => {
        sessions.delete(key);
        events.delete(range(key));
      });
    },

    get degraded() { return degraded; },
  };
  return store;
}
