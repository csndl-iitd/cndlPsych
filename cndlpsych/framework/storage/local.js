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

const VERSION = 3;
const MAX_BUFFER = 200;
const SESSIONS = 'sessions';
const EVENTS = 'events';
const MEDIA = 'media'; // webcam video, in pieces: {session, segment, index, blob}
const STREAMS = 'streams'; // raw device data, in batches: {session, segment, index, chunks, data}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * @param {{indexedDB?: IDBFactory, IDBKeyRange?: object, flushMs?: number, schedule?: Function, dbName?: string, now?: () => string}} [options]
 */
export function createLocalStore({
  indexedDB = globalThis.indexedDB, IDBKeyRange = globalThis.IDBKeyRange, flushMs = 2000, schedule = defaultSchedule,
  dbName = 'cndlpsych', now = () => new Date().toISOString(),
} = {}) {
  let db = null;
  let session = null; // {key, record}
  let buffer = [];
  let memory = [];
  let memoryMedia = [];
  let memoryStreams = [];
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
        const names = req.result.objectStoreNames;
        if (!names.contains(SESSIONS)) req.result.createObjectStore(SESSIONS, { keyPath: 'key' });
        if (!names.contains(EVENTS)) req.result.createObjectStore(EVENTS, { keyPath: ['session', 'seq'] });
        if (!names.contains(MEDIA)) req.result.createObjectStore(MEDIA, { keyPath: ['session', 'segment', 'index'] });
        if (!names.contains(STREAMS)) req.result.createObjectStore(STREAMS, { keyPath: ['session', 'segment', 'index'] });
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
  const mediaRange = (key) => IDBKeyRange.bound([key, 0, 0], [key, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]);

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

    // ---- webcam video -------------------------------------------------------------------------
    /** One piece of the webcam recording ({segment, index, blob, t}). Rejects when it could not be kept, so the recorder can say so. */
    async addMedia(piece) {
      await chain;
      if (degraded || !db) {
        memoryMedia.push({ segment: piece.segment, index: piece.index, blob: piece.blob });
        return;
      }
      try {
        await work([MEDIA], 'readwrite', (media) => { media.put({ session: session.key, segment: piece.segment, index: piece.index, blob: piece.blob, t: piece.t }); });
      } catch (error) {
        memoryMedia.push({ segment: piece.segment, index: piece.index, blob: piece.blob });
        throw error;
      }
    },

    /** The video pieces of a session (the current one by default), in order: [{segment, index, blob}]. */
    async readMedia(key = session?.key) {
      await ready();
      const kept = key === session?.key ? memoryMedia : [];
      const stored = db && key ? await work([MEDIA], 'readonly', (media) => request(media.getAll(mediaRange(key)))) : [];
      return [...stored.map(({ segment, index, blob }) => ({ segment, index, blob })), ...kept].sort((a, b) => a.segment - b.segment || a.index - b.index);
    },

    // ---- raw device data ----------------------------------------------------------------------
    /** One batch of the trigger device's traffic ({segment, index, chunks, data}). Rejects when it could not be kept on disk (it is kept in memory). */
    async addStream(piece) {
      await chain;
      if (degraded || !db) {
        memoryStreams.push(piece);
        return;
      }
      try {
        await work([STREAMS], 'readwrite', (streams) => { streams.put({ session: session.key, ...piece }); });
      } catch (error) {
        memoryStreams.push(piece);
        throw error;
      }
    },

    /** The batches of a session (the current one by default), in order. */
    async readStreams(key = session?.key) {
      await ready();
      const kept = key === session?.key ? memoryStreams : [];
      const stored = db && key ? await work([STREAMS], 'readonly', (streams) => request(streams.getAll(mediaRange(key)))) : [];
      return [...stored.map(({ segment, index, chunks, data }) => ({ segment, index, chunks, data })), ...kept].sort((a, b) => a.segment - b.segment || a.index - b.index);
    },

    /** The number for the next run of device data in this session: one more than the highest kept (a resumed session has earlier ones). */
    async nextStreamSegment() {
      return (await store.readStreams()).reduce((highest, piece) => Math.max(highest, piece.segment), 0) + 1;
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

    /** Every stored session, newest first, whatever its status (the manager screen lists these). */
    async listSessions() {
      if (!(await exists())) return [];
      await ready();
      if (!db) return [];
      const rows = await work([SESSIONS], 'readonly', (sessions) => request(sessions.getAll()));
      return rows
        .map((row) => ({ key: row.key, record: row.record, status: row.status, lastSeq: row.last_seq, updatedAt: row.updated_at }))
        .sort((a, b) => String(b.record.started_at).localeCompare(String(a.record.started_at)));
    },

    /**
     * Reopen a stored session so new events continue its log. The next event must be
     * `lastSeq + 1`; the record is replaced by the resumed one (status in_progress).
     * @returns {Promise<{lastSeq: number}>}
     */
    async resume(key, record) {
      await ready();
      if (!db) throw new Error('local storage is not available, so the session cannot be resumed');
      const row = await work([SESSIONS], 'readonly', (sessions) => request(sessions.get(key)));
      if (!row) throw new Error('the stored session no longer exists');
      session = { key, record };
      lastSeq = row.last_seq;
      buffer = [];
      memory = [];
      memoryMedia = [];
      memoryStreams = [];
      await putSession({ record, status: 'in_progress' });
      setStatus('ready');
      return { lastSeq: row.last_seq };
    },

    /** What the Firebase mirror reports about its progress (see storage/firebase.js); kept so a resumed session can carry on. */
    setRemote(remote) {
      chain = chain.then(() => putSession({ remote }));
      return chain;
    },

    /** @returns {Promise<{record: object, events: object[], remote?: object}|null>} */
    async read(key) {
      await ready();
      if (!db) return null;
      return work([SESSIONS, EVENTS], 'readonly', async (sessions, events) => {
        const row = await request(sessions.get(key));
        if (!row) return null;
        return { record: row.record, remote: row.remote, events: (await request(events.getAll(range(key)))).map((r) => r.event) };
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
      await work([SESSIONS, EVENTS, MEDIA, STREAMS], 'readwrite', async (sessions, events, media, streams) => {
        sessions.delete(key);
        events.delete(range(key));
        media.delete(mediaRange(key));
        streams.delete(mediaRange(key));
      });
    },

    get degraded() { return degraded; },
  };
  return store;
}
