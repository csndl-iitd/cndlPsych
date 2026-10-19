// Firestore storage (spec/firebase/DESIGN.md). The only module that touches the Firebase SDK
// (hard rule 2), and only through dynamic import, so an experiment without Firebase never
// loads it.
//
// The store is a mirror of the local log: the local journal stays the source for recovery,
// this uploads the same events as numbered chunks. A chunk's index and range are written to
// the journal (onProgress) before it is sent, so after a crash the same chunk can be rebuilt
// byte for byte and re-sent; the rules accept a rewrite only if it is identical.
import { allocateControlled, allocatePublic, suggestControlled } from './allocator.js';
import { createRng } from '../foundation/rng.js';
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_EVENTS, makeChunks } from './chunks.js';

const SESSION_END_KEYS = ['status', 'ended_at', 'end_reason', 'eyetracking', 'sinks', 'n_chunks', 'last_seq'];
const RETRY_DELAY_MS = 1000;
const RETRIES = 3;

const plain = (value) => JSON.parse(JSON.stringify(value)); // Firestore rejects undefined values
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const sessionKey = (record) => `${record.subject_id}_${record.session_id}`;

/** The SDK modules; imported on demand. */
export async function loadSdk() {
  const [app, firestore] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
  return { app, firestore };
}

async function signIn({ sdk, app, access }) {
  sdk.auth ??= await import('firebase/auth');
  const auth = sdk.auth.getAuth(app);
  const credential = access === 'public'
    ? await sdk.auth.signInAnonymously(auth)
    : await sdk.auth.signInWithPopup(auth, new sdk.auth.GoogleAuthProvider());
  return credential.user.uid;
}

async function startAppCheck({ app, config }) {
  if (!config.app_check) return;
  const appCheck = await import('firebase/app-check');
  const Provider = config.app_check.provider === 'recaptcha_enterprise' ? appCheck.ReCaptchaEnterpriseProvider : appCheck.ReCaptchaV3Provider;
  appCheck.initializeAppCheck(app, { provider: new Provider(config.app_check.site_key), isTokenAutoRefreshEnabled: true });
}

/** Every Firestore operation the framework needs; the allocator and the store use only these. */
function createOps({ fs, db, experimentId, uid }) {
  const base = `experiments/${experimentId}`;
  const claimRef = (n) => fs.doc(db, `${base}/claims/${n}`);
  const markerRef = fs.doc(db, `${base}/claims_by_uid/${uid}`);
  const sessionRef = (key) => fs.doc(db, `${base}/data/${uid}/sessions/${key}`);
  // A transaction reads straight from the server. getDoc / getDocFromServer go through the SDK's
  // listener cache, which was seen reporting a claim as missing long after it existed (it kept
  // an earlier "does not exist" answer), so a loser would retry the same number forever.
  const readFresh = (ref) => fs.runTransaction(db, (transaction) => transaction.get(ref));
  const claimData = (n, label) => ({ n, label, status: 'reserved', created_at: fs.serverTimestamp() });
  return {
    async claimExists(n) { return (await readFresh(claimRef(n))).exists(); },
    async markerNumber() {
      const snapshot = await readFresh(markerRef);
      return snapshot.exists() ? snapshot.data().n : null;
    },
    async createPublicClaim(n, label) {
      const batch = fs.writeBatch(db);
      batch.set(claimRef(n), claimData(n, label));
      batch.set(markerRef, { n, created_at: fs.serverTimestamp() });
      await batch.commit();
    },
    async listClaimNumbers() { return (await fs.getDocs(fs.collection(db, `${base}/claims`))).docs.map((d) => d.data().n); },
    createClaim: (n, label) => fs.setDoc(claimRef(n), claimData(n, label)),
    setClaimStatus: (n, status) => fs.updateDoc(claimRef(n), { status }),
    createSession: (key, doc) => fs.setDoc(sessionRef(key), doc),
    updateSession: (key, fields) => fs.updateDoc(sessionRef(key), fields),
    putChunk: (key, chunk) => fs.setDoc(fs.doc(db, `${base}/data/${uid}/sessions/${key}/chunks/${chunk.i}`), chunk),
  };
}

/**
 * Sign in and open Firestore.
 * @param {{config: object, sdk?: object, emulator?: {host: string, port: number, token: object}, appName?: string}} options
 *   `config` is `storage.firebase`. `emulator` skips sign-in and acts as the user in `token`
 *   (its `sub` is the uid); it exists for tests.
 * @returns {Promise<{uid: string, ops: object, access: string, width: number}>}
 */
export async function connectFirebase({ config, sdk, emulator, appName = '[DEFAULT]' }) {
  const modules = sdk ?? await loadSdk();
  const app = modules.app.initializeApp(config.web_config, appName);
  const db = modules.firestore.getFirestore(app);
  let uid;
  if (emulator) {
    modules.firestore.connectFirestoreEmulator(db, emulator.host, emulator.port, { mockUserToken: emulator.token });
    uid = emulator.token.sub;
  } else {
    await startAppCheck({ app, config });
    uid = await signIn({ sdk: modules, app, access: config.access });
  }
  const ops = createOps({ fs: modules.firestore, db, experimentId: config.experiment_id, uid });
  return { uid, ops, access: config.access, width: config.subject_id?.width ?? 3 };
}

/** The subject number this connection will use. Public: assigned now. Controlled: see suggestSubject. */
export async function allocateSubject(connection, { override = null } = {}) {
  // Random-looking but reproducible per user: lost races are retried after different pauses.
  const rng = createRng(0).fork(connection.uid);
  const options = { width: connection.width, wait: (attempt) => pause(rng.int(0, Math.min(400, 15 * 2 ** attempt))) };
  return connection.access === 'public'
    ? allocatePublic(connection.ops, options)
    : allocateControlled(connection.ops, { ...options, override });
}

/** Controlled mode: the number to prefill in the subject form. */
export const suggestSubject = (connection) => suggestControlled(connection.ops, { width: connection.width });

/**
 * @param {{connection: object, claim: {n: number}, config: object, onProgress?: (remote: object) => Promise<void>|void, retryDelayMs?: number, schedule?: Function}} options
 *   `claim` is the number from allocateSubject; `config` is `storage.firebase`;
 *   `onProgress` receives {next_chunk, uploaded_seq, pending} whenever it changes.
 */
export function createFirebaseStore({ connection, claim, config, onProgress = () => {}, retryDelayMs = RETRY_DELAY_MS, schedule }) {
  const { ops, uid } = connection;
  const limits = { maxEvents: config.chunk?.max_events ?? DEFAULT_MAX_EVENTS, maxBytes: config.chunk?.max_bytes ?? DEFAULT_MAX_BYTES };
  const flushMs = config.chunk?.flush_ms ?? 10_000;
  const setTimer = schedule ?? ((ms, fn) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); });
  const statuses = [];
  const handlers = [];
  let key = null;
  let buffer = [];
  let queue = [];
  let nextChunk = 0;
  let uploadedChunks = 0; // chunk indices below this are in Firestore
  let uploadedSeq = -1;
  let lastSeq = -1;
  let chain = Promise.resolve();
  let cancelTimer = null;
  let broken = false;
  let lastState = null;

  function setStatus(state, detail) {
    if (state === lastState && !detail) return;
    lastState = state;
    const status = { state, ...(detail ? { detail } : {}) };
    statuses.push(status);
    handlers.forEach((handler) => handler(status));
  }

  const progress = (pending) => onProgress({ next_chunk: uploadedChunks, uploaded_seq: uploadedSeq, pending });

  async function send(chunk) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await ops.putChunk(key, chunk);
        return;
      } catch (error) {
        if (attempt >= RETRIES) throw error;
        await pause(retryDelayMs * (attempt + 1));
      }
    }
  }

  /** Upload queued chunks in order; a chunk that keeps failing stays queued for the next flush. */
  async function drain() {
    while (queue.length && !broken) {
      const [chunk] = queue;
      await progress({ i: chunk.i, from_seq: chunk.from_seq, to_seq: chunk.to_seq });
      try {
        await send(chunk);
      } catch (error) {
        setStatus('degraded', `chunk ${chunk.i} could not be uploaded (${error.code ?? error.message}); retrying at the next flush`);
        return;
      }
      queue.shift();
      uploadedSeq = chunk.to_seq;
      uploadedChunks = chunk.i + 1;
      await progress(null);
      setStatus('ready');
    }
  }

  function cut() {
    const events = buffer.splice(0);
    if (!events.length || broken) return;
    chain = chain.then(async () => {
      const chunks = await makeChunks(events, { ...limits, firstIndex: nextChunk });
      queue.push(...chunks);
      nextChunk += chunks.length;
      await drain();
    });
  }

  function flush() {
    cancelTimer?.();
    cancelTimer = null;
    cut();
    chain = chain.then(drain);
    return chain;
  }

  const arm = () => { cancelTimer ??= setTimer(flushMs, () => { cancelTimer = null; flush(); }); };

  function fail(error) {
    broken = true;
    setStatus('error', `${error.code ?? ''} ${error.message ?? error}`.trim());
  }

  return {
    onStatus(handler) {
      handlers.push(handler);
      statuses.forEach(handler);
    },

    /** Create the session document and activate the claim. Call once recording starts. */
    begin(record) {
      key = sessionKey(record);
      const doc = plain({ ...record, uid, experiment_id: config.experiment_id, status: 'in_progress' });
      setStatus('opening');
      chain = chain.then(async () => {
        try {
          await ops.createSession(key, doc);
          await ops.setClaimStatus(claim.n, 'active');
          setStatus('ready');
        } catch (error) {
          fail(error);
        }
      });
    },

    /**
     * Carry on an interrupted session: rebuild the chunk that was in flight, then re-queue every
     * stored event that never reached Firestore.
     * @param {object} remote what onProgress last reported, as the journal kept it
     * @param {object[]} events the session's events from the local journal
     */
    resume(record, remote, events) {
      key = sessionKey(record);
      uploadedChunks = remote?.next_chunk ?? 0;
      nextChunk = uploadedChunks;
      uploadedSeq = remote?.uploaded_seq ?? -1;
      lastSeq = events.at(-1)?.seq ?? -1;
      chain = chain.then(async () => {
        let rest = events.filter((event) => event.seq > uploadedSeq);
        const pending = remote?.pending;
        if (pending) {
          const inFlight = rest.filter((event) => event.seq <= pending.to_seq);
          queue.push(...await makeChunks(inFlight, { ...limits, firstIndex: pending.i }));
          rest = rest.filter((event) => event.seq > pending.to_seq);
        }
        if (rest.length) queue.push(...await makeChunks(rest, { ...limits, firstIndex: pending ? pending.i + queue.length : nextChunk }));
        nextChunk = queue.length ? queue.at(-1).i + 1 : nextChunk;
        setStatus('ready');
        await drain();
      });
    },

    append(event) {
      buffer.push(event);
      lastSeq = event.seq;
      if (buffer.length >= limits.maxEvents) flush();
      else arm();
    },

    flush,

    /** Send what is left, then write the end-of-session bookkeeping once and settle the claim. */
    async finish(record) {
      await flush();
      await chain;
      if (!broken) {
        const fields = plain(Object.fromEntries(SESSION_END_KEYS.filter((name) => record[name] !== undefined).map((name) => [name, record[name]])));
        try {
          await ops.updateSession(key, { ...fields, n_chunks: nextChunk, last_seq: record.last_seq ?? lastSeq });
          if (record.status === 'complete') await ops.setClaimStatus(claim.n, 'complete');
          else if (record.status === 'device_rejected') await ops.setClaimStatus(claim.n, 'void');
        } catch (error) {
          fail(error);
        }
      }
      setStatus('closed');
    },

    get pendingChunks() { return queue.length; },
    get broken() { return broken; },
  };
}
