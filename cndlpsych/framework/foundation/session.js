// The session record (session.schema.json), ids, the consent gate, and URL parameters.
// Nothing here persists anything: the record can only be built after consent is accepted,
// which is how the "nothing is stored before consent" rule is enforced at the source.

const LABEL = /^[A-Za-z0-9]+$/;

/** 'sub-007' / '007' -> 'sub-007' (BIDS label); null when the label is not alphanumeric. */
function normalizeLabel(raw, prefix) {
  const text = String(raw ?? '').trim();
  const label = text.startsWith(`${prefix}-`) ? text.slice(prefix.length + 1) : text;
  return LABEL.test(label) ? `${prefix}-${label}` : null;
}

export const normalizeSubjectId = (raw) => normalizeLabel(raw, 'sub');
export const normalizeSessionId = (raw) => normalizeLabel(raw, 'ses');

/** Zero-padded subject / session label, e.g. formatLabel('sub', 7, 3) -> 'sub-007'. */
export function formatLabel(prefix, number, width) {
  return `${prefix}-${String(number).padStart(width, '0')}`;
}

/** Copy the named query parameters that are present (values stay strings). */
export function parseUrlParams(search, names = []) {
  const params = new URLSearchParams(search);
  return Object.fromEntries(names.filter((name) => params.has(name)).map((name) => [name, params.get(name)]));
}

/** `seed: auto` draws an unsigned 32-bit integer from the platform's secure generator. */
export function resolveSeed(seed, cryptoSource = globalThis.crypto) {
  if (Number.isInteger(seed)) return seed;
  if (seed !== undefined && seed !== 'auto') throw new TypeError(`seed must be an integer or "auto", got ${JSON.stringify(seed)}`);
  return cryptoSource.getRandomValues(new Uint32Array(1))[0];
}

/** 'sha256:<hex>' of a text (consent text, spec). */
export async function hashText(text, subtle = globalThis.crypto.subtle) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The consent gate. Required statements (default: all) must be accepted; `min_age` is
 * checked separately against the age answer, which is collected after consent.
 * @param {{mode?: 'on_screen'|'attested', statements?: {id: string, required?: boolean}[], min_age?: number}} spec
 */
export function createConsentGate({ mode = 'on_screen', statements = [], min_age: minAge } = {}) {
  let state = 'pending';
  let answers = [];

  return {
    get state() { return state; },
    get accepted() { return state === 'accepted'; },

    /** @param {Record<string, boolean>} given statement id -> accepted */
    accept(given = {}) {
      if (state === 'declined') return { ok: false, reason: 'declined' };
      const missing = statements.filter((s) => s.required !== false && given[s.id] !== true).map((s) => s.id);
      if (missing.length) return { ok: false, reason: 'statement_required', ids: missing };
      answers = statements.map((s) => ({ id: s.id, accepted: given[s.id] === true }));
      state = 'accepted';
      return { ok: true };
    },

    decline() {
      state = 'declined';
    },

    /** Is the age answer enough to take part? Unknown age fails when min_age is set. */
    checkAge(age) {
      if (minAge === undefined) return { eligible: true };
      return { eligible: typeof age === 'number' && age >= minAge, min_age: minAge };
    },

    /** The `consent` block of the session record. */
    record({ textHash, acceptedAt }) {
      if (state !== 'accepted') throw new Error('consent has not been accepted');
      return { mode, text_hash: textHash, accepted_at: acceptedAt, ...(answers.length ? { statements: answers } : {}) };
    },
  };
}

const OPTIONAL_FIELDS = ['experiment_id', 'uid', 'subject', 'session_fields', 'url_params', 'sinks', 'eyetracking', 'overlays'];
const STATUS_BY_REASON = { complete: 'complete', aborted: 'aborted', error: 'error', device_rejected: 'device_rejected' };

/**
 * Build the session record at recording start (status in_progress).
 * Throws without a consent block: the record must not exist before consent.
 */
export function createSessionRecord(fields) {
  const { subjectId, sessionId, startedAt, experiment, consent, device, clock, stage } = fields;
  if (!consent) throw new Error('a session record needs accepted consent');
  const record = {
    schema_version: 1,
    subject_id: subjectId,
    session_id: sessionId,
    status: 'in_progress',
    started_at: startedAt,
    ended_at: null,
    experiment,
    consent,
    device,
    clock,
    stage,
  };
  for (const key of OPTIONAL_FIELDS) {
    if (fields[key] !== undefined) record[key] = fields[key];
  }
  return record;
}

/** A copy of the record closed with the end reason; `nChunks` / `lastSeq` support export integrity checks. */
export function finishSessionRecord(record, { reason, endedAt, nChunks, lastSeq }) {
  const status = STATUS_BY_REASON[reason];
  if (!status) throw new TypeError(`unknown end reason "${reason}"`);
  return {
    ...record,
    status,
    end_reason: reason,
    ended_at: endedAt,
    ...(nChunks === undefined ? {} : { n_chunks: nChunks }),
    ...(lastSeq === undefined ? {} : { last_seq: lastSeq }),
  };
}
