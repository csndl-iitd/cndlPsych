// The Firebase side of a session, as the lifecycle sees it (ARCHITECTURE.md section 8):
// sign in, get a subject number, then mirror the local log to Firestore. Everything that
// touches the SDK lives in storage/firebase.js; this wires it to the session.
import { allocateSubject, connectFirebase, createFirebaseStore, suggestSubject } from '../storage/firebase.js';

/** The message when the data server cannot be reached. */
export const remoteFailedMessage = (reason) => `Could not connect to the data server: ${reason}

Nothing has been stored. Please tell the experimenter.`;

/** The subject ID field when Firebase assigns the number: hidden (public) or prefilled (controlled). */
export async function assignedSubject(remote) {
  if (!remote) return {};
  if (remote.access === 'public') return { hidden: true };
  return { value: (await remote.suggest()).label, locked: !remote.allowOverride };
}

const DIGITS = /^(?:sub-)?(\d+)$/;

/** The claim number in a subject ID typed or prefilled in controlled mode ("007", "sub-007"), else null. */
export function claimNumber(raw) {
  const match = DIGITS.exec(String(raw ?? '').trim());
  return match ? Number(match[1]) : null;
}

/**
 * @param {object} config `storage.firebase`
 * @param {{connect?: Function}} [options] `connect` replaces connectFirebase (tests)
 */
export function createRemote(config, { connect = connectFirebase } = {}) {
  let connection = null;
  return {
    access: config.access,
    allowOverride: config.subject_id?.override === true,

    /** Sign in. Controlled mode opens a popup, so call this from a click. */
    async signIn() {
      connection = await connect({ config });
      return connection.uid;
    },

    /** Controlled mode: the number to prefill. */
    suggest: () => suggestSubject(connection),

    /**
     * Claim a subject number: public mode takes the next free one; controlled mode takes the
     * number typed in the form (the suggestion unless the experimenter overrode it).
     * @returns {Promise<{n: number, label: string}>}
     */
    async claim(typed) {
      if (config.access === 'public') return allocateSubject(connection);
      const n = claimNumber(typed);
      if (n === null) throw new Error('Subject IDs must be numbers (for example 007) when Firebase assigns them.');
      return allocateSubject(connection, { override: n });
    },

    /** A mirror store for the claimed number; `onProgress` receives its upload bookkeeping. */
    store: ({ claim, onProgress }) => createFirebaseStore({ connection, claim, config, onProgress }),
  };
}

/**
 * Write to the local store and mirror to Firebase. The local store stays the source for
 * everything that reads back (snapshot, recovery, resume); the mirror only uploads.
 * @param {object} local
 * @param {object} mirror
 */
export function mirrored(local, mirror) {
  const both = (name) => (...args) => Promise.all([local[name]?.(...args), mirror[name]?.(...args)]).then(() => undefined);
  return {
    ...local,
    begin(record) { local.begin(record); mirror.begin(record); },
    append(event) { local.append(event); mirror.append(event); },
    flush: both('flush'),
    finish: both('finish'),
    /** Statuses of both, told apart by `sink`. */
    onStatus(handler) {
      local.onStatus?.((status) => handler({ sink: 'local', ...status }));
      mirror.onStatus((status) => handler({ sink: 'firebase', ...status }));
    },
    get degraded() { return local.degraded; },
  };
}
