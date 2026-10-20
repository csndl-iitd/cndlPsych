// The Firestore chunk codec (reference: spec/tools/chunks.py; spec/firebase/DESIGN.md).
//
// The event stream is cut into chunks; each stores its events as ONE string (NDJSON,
// optionally gzip + base64) because Firestore rejects arrays nested directly in arrays and
// pointer / gaze sample rows are arrays of arrays. Payloads are ASCII-only, so a string's
// length equals its byte size, which is what the rules' size() check relies on.
//
// Differences from the Python reference that do not change meaning: numbers print the JS
// way (1211, where Python prints 1211.0), and gzip bytes may differ (header fields), so
// parity is checked by decoding, never by comparing gzip text.

const BASE64_BOUND = 1.37; // base64 of gzip output is at most ~1.37x the raw size in the worst case

export const DEFAULT_MAX_EVENTS = 400;
export const DEFAULT_MAX_BYTES = 600_000;

/** JSON with every non-ASCII UTF-16 unit written as a lowercase \uXXXX escape (Python's ensure_ascii). */
export function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

const ndjson = (events) => events.map(asciiJson).join('\n');

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const toBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

/** One chunk document for these events. */
export async function encodeChunk(events, i, encoding = 'json') {
  const text = ndjson(events);
  const payload = encoding === 'json'
    ? text
    : toBase64(await pipe(new TextEncoder().encode(text), new CompressionStream('gzip')));
  return {
    i,
    n_events: events.length,
    from_seq: events[0].seq,
    to_seq: events.at(-1).seq,
    t_first: events[0].t,
    t_last: events.at(-1).t,
    encoding,
    payload,
  };
}

/**
 * Cut events into chunks of at most maxEvents events and maxBytes of payload.
 * @param {{maxEvents?: number, maxBytes?: number, encoding?: 'json'|'gzip-base64', firstIndex?: number}} [options]
 *   `firstIndex` numbers the chunks from there (a resumed session continues its indices)
 */
export async function makeChunks(events, { maxEvents = DEFAULT_MAX_EVENTS, maxBytes = DEFAULT_MAX_BYTES, encoding = 'json', firstIndex = 0 } = {}) {
  const rawLimit = encoding === 'json' ? maxBytes : Math.floor(maxBytes / BASE64_BOUND);
  const groups = [];
  let buffer = [];
  let bufferBytes = 0;
  for (const event of events) {
    const size = asciiJson(event).length + 1;
    if (size > rawLimit) throw new Error(`event seq ${event.seq} (${size} B) exceeds the chunk limit; producers must cap sample chunks`);
    if (buffer.length && (buffer.length >= maxEvents || bufferBytes + size > rawLimit)) {
      groups.push(buffer);
      buffer = [];
      bufferBytes = 0;
    }
    buffer.push(event);
    bufferBytes += size;
  }
  if (buffer.length) groups.push(buffer);
  return Promise.all(groups.map((group, index) => encodeChunk(group, firstIndex + index, encoding)));
}

export async function decodeChunk(chunk) {
  const text = chunk.encoding === 'gzip-base64'
    ? new TextDecoder().decode(await pipe(fromBase64(chunk.payload), new DecompressionStream('gzip')))
    : chunk.payload;
  return text.split('\n').map((line) => JSON.parse(line));
}

/**
 * Merge chunks into an event list, reporting integrity problems. Duplicated chunks (retries)
 * are tolerated; missing chunk indices and seq gaps are reported so export can flag
 * incomplete sessions.
 * @returns {Promise<{events: object[], issues: string[]}>}
 */
export async function readChunks(chunks) {
  const issues = [];
  const events = [];
  const seen = new Set();
  let expectedIndex = 0;
  let lastSeq = null;
  for (const chunk of [...chunks].sort((a, b) => a.i - b.i)) {
    if (seen.has(chunk.i)) {
      issues.push(`duplicate chunk ${chunk.i}`);
      continue;
    }
    seen.add(chunk.i);
    if (chunk.i !== expectedIndex) issues.push(`missing chunk(s) ${expectedIndex}..${chunk.i - 1}`);
    expectedIndex = chunk.i + 1;
    const decoded = await decodeChunk(chunk);
    if (decoded.length !== chunk.n_events) issues.push(`chunk ${chunk.i}: n_events ${chunk.n_events} != ${decoded.length} decoded`);
    if (lastSeq !== null && decoded.length && decoded[0].seq !== lastSeq + 1) issues.push(`seq gap before chunk ${chunk.i}: ${lastSeq} -> ${decoded[0].seq}`);
    if (decoded.length) lastSeq = decoded.at(-1).seq;
    events.push(...decoded);
  }
  return { events, issues };
}

/** True if a JSON value contains an array directly inside an array (Firestore rejects these). */
export function hasNestedArray(node, insideArray = false) {
  if (Array.isArray(node)) return insideArray || node.some((item) => hasNestedArray(item, true));
  if (node && typeof node === 'object') return Object.values(node).some((v) => hasNestedArray(v, false));
  return false;
}
