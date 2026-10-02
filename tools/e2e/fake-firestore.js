// A stand-in for Firestore that lives in the test (Node) process, so it outlives a killed
// browser. It enforces the same rules the real ones do for what the lifecycle exercises:
// create-only claims, contiguous public numbers, one number per user, one end-of-session
// update, identical chunk rewrites. The real rules are tested against the emulator
// (spec/firebase/rules.emulator.test.js); this only lets browser tests run without one.
const denied = () => ({ code: 'permission-denied', message: 'denied by the fake rules' });

export function createFakeFirestore({ uid = 'anon-1', access = 'public', failSignIn = null } = {}) {
  const state = { claims: new Map(), markers: new Map(), sessions: new Map(), chunks: new Map(), signIns: 0, failSignIn };
  const sessionKey = (key) => `${uid}/${key}`;
  const chunkKey = (key, i) => `${uid}/${key}/${i}`;

  const ops = {
    signIn() {
      state.signIns += 1;
      if (state.failSignIn) throw Object.assign(new Error(state.failSignIn), { code: 'auth/failed' });
      return { uid, access };
    },
    claimExists: (n) => state.claims.has(n),
    markerNumber: () => state.markers.get(uid) ?? null,
    listClaimNumbers: () => [...state.claims.keys()],
    createPublicClaim(n, label) {
      if (state.claims.has(n) || (n > 1 && !state.claims.has(n - 1)) || state.markers.has(uid)) throw denied();
      state.claims.set(n, { n, label, status: 'reserved' });
      state.markers.set(uid, n);
    },
    createClaim(n, label) {
      if (state.claims.has(n)) throw denied();
      state.claims.set(n, { n, label, status: 'reserved' });
    },
    setClaimStatus(n, status) { state.claims.get(n).status = status; },
    createSession(key, doc) { state.sessions.set(sessionKey(key), doc); },
    updateSession(key, fields) {
      const stored = state.sessions.get(sessionKey(key));
      if (!stored || stored.status !== 'in_progress') throw denied();
      Object.assign(stored, fields);
    },
    putChunk(key, chunk) {
      const existing = state.chunks.get(chunkKey(key, chunk.i));
      if (existing && JSON.stringify(existing) !== JSON.stringify(chunk)) throw denied();
      state.chunks.set(chunkKey(key, chunk.i), chunk);
    },
  };

  return {
    state,
    /** The binding the page calls: results and errors are plain data so they cross the boundary. */
    handle(_source, op, args) {
      try {
        return { value: ops[op](...args) ?? null };
      } catch (error) {
        return { error: { code: error.code, message: error.message } };
      }
    },
    /** What was stored for a session, in the shape export reads. */
    stored(key) {
      const chunks = [...state.chunks].filter(([name]) => name.startsWith(`${uid}/${key}/`)).map(([, chunk]) => chunk);
      return { session: state.sessions.get(sessionKey(key)), chunks, claims: [...state.claims.values()] };
    },
  };
}
