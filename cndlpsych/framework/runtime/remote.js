// The Firebase side of a session, as the lifecycle sees it (ARCHITECTURE.md section 8):
// sign in, get a subject number, then mirror the local log to Firestore. Everything that
// touches the SDK lives in storage/firebase.js; this wires it to the session.
import { allocateSubject, connectFirebase, createFirebaseStore, suggestSubject, subjectNumberTaken } from '../storage/firebase.js';

/** The message when the data server cannot be reached. */
export const remoteFailedMessage = (reason) => `Could not connect to the data server: ${reason}

Nothing has been stored. Please tell the experimenter.`;

const METHOD = { public: 'Anonymous', controlled: 'Google' };

/**
 * What a Firebase error means for the person running the experiment, with what to change. The code is
 * always kept in the text, so an unknown one can still be looked up.
 * @param {{code?: string, message?: string}} error
 * @param {{access?: string, experiment_id?: string, web_config?: {projectId?: string}}} config `storage.firebase`
 * @param {string} [host] the page's host name (an authorised domain is needed for sign-in)
 */
export function explainRemoteError(error, config = {}, host = globalThis.location?.hostname ?? 'this website') {
  const code = error?.code ?? '';
  const method = METHOD[config.access] ?? 'the sign-in';
  const project = config.web_config?.projectId ?? 'your project';
  const where = 'Firebase console > Authentication';
  const advice = {
    'auth/operation-not-allowed': `${method} sign-in is not switched on for the project "${project}". Open ${where} > Sign-in method, enable ${method}, save, and try again.`,
    'auth/configuration-not-found': `Authentication has not been set up for the project "${project}". Open ${where} and press "Get started", then enable ${method} under Sign-in method.`,
    'auth/unauthorized-domain': `"${host}" is not an authorised domain. Add it in ${where} > Settings > Authorized domains (localhost is there by default; a deployed site needs its own address).`,
    'auth/invalid-api-key': 'The apiKey in storage.firebase.web_config is not valid. Copy it again from Project settings > Your apps in the Firebase console.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The apiKey in storage.firebase.web_config is not valid. Copy it again from Project settings > Your apps in the Firebase console.',
    'auth/popup-blocked': 'The browser blocked the sign-in window. Allow pop-ups for this site and try again.',
    'auth/popup-closed-by-user': 'The sign-in window was closed before signing in.',
    'auth/cancelled-popup-request': 'The sign-in window was closed before signing in.',
    'auth/network-request-failed': 'The connection to Firebase failed. Check the network and try again.',
    'permission-denied': config.access === 'public'
      ? `The database refused the request. Publish the rules in spec/firebase/firestore.public.rules (Firebase console > Firestore > Rules) and check that the experiment id is "${config.experiment_id}".`
      : `The database refused the request. The account you signed in with must have a verified email and be listed as a document in experiments/${config.experiment_id}/admins/<email> (Firebase console > Firestore), and the rules in spec/firebase/firestore.controlled.rules must be published.`,
  };
  const text = advice[code];
  return text ? `${text} (${code})` : String(error?.message ?? error);
}

/**
 * The subject ID field when Firebase assigns the number: hidden (public) or prefilled (controlled; the experimenter
 * may type another number unless the experiment locks it).
 */
export async function assignedSubject(remote) {
  if (!remote) return {};
  if (remote.access === 'public') return { hidden: true };
  const { n, label } = await remote.suggest();
  return { value: label, n, locked: !remote.allowOverride, ...(remote.allowOverride ? { overridable: true } : {}) };
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
    config,
    access: config.access,
    allowOverride: config.access === 'controlled' && config.subject_id?.override !== false,

    /** Sign in. Controlled mode opens a popup, so call this from a click. */
    async signIn() {
      connection = await connect({ config });
      return connection.uid;
    },

    /** Controlled mode: the number to prefill. */
    suggest: () => suggestSubject(connection),

    /** The number in a subject ID as typed ("007", "sub-7"), or null when it is not one. */
    numberOf: claimNumber,

    /** Controlled mode: has the number in this subject ID already been used? */
    async isTaken(typed) {
      const n = claimNumber(typed);
      return n !== null && subjectNumberTaken(connection, n);
    },

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
