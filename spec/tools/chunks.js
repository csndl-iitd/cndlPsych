// Reference implementation of the Firestore chunk format, ported from chunks.py.
//
// An event stream is cut into chunks; each chunk stores its events as ONE string
// (NDJSON, optionally gzip+base64) because Firestore rejects nested arrays and our
// pointer/gaze sample rows are arrays of arrays. Payloads are ASCII-only so a
// string's length equals its byte size, matching the rules' size() check and the
// 1 MiB document limit.
import { gzipSync, gunzipSync } from 'node:zlib';

// base64 of gzip output is at most ~1.37x the raw size in the worst case
const BASE64_BOUND = 1.37;

/** JSON.stringify with every non-ASCII UTF-16 unit written as a lowercase \uXXXX escape. */
export function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[\u0080-￿]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

const ndjson = (events) => events.map(asciiJson).join('\n');

export function encodeChunk(events, i, encoding = 'json') {
  const text = ndjson(events);
  const payload = encoding === 'json'
    ? text
    : gzipSync(Buffer.from(text, 'ascii')).toString('base64');
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

/** Cut events into chunks no larger than maxEvents / maxBytes (payload bytes). */
export function makeChunks(events, { maxEvents = 400, maxBytes = 600_000, encoding = 'json' } = {}) {
  const rawLimit = encoding === 'json' ? maxBytes : Math.floor(maxBytes / BASE64_BOUND);
  const chunks = [];
  let buffer = [];
  let bufferBytes = 0;
  for (const event of events) {
    const size = asciiJson(event).length + 1;
    if (size > rawLimit) {
      throw new Error(`event seq ${event.seq} (${size} B) exceeds the chunk limit; producers must cap sample chunks`);
    }
    if (buffer.length && (buffer.length >= maxEvents || bufferBytes + size > rawLimit)) {
      chunks.push(encodeChunk(buffer, chunks.length, encoding));
      buffer = [];
      bufferBytes = 0;
    }
    buffer.push(event);
    bufferBytes += size;
  }
  if (buffer.length) chunks.push(encodeChunk(buffer, chunks.length, encoding));
  return chunks;
}

export function decodeChunk(chunk) {
  const text = chunk.encoding === 'gzip-base64'
    ? gunzipSync(Buffer.from(chunk.payload, 'base64')).toString('ascii')
    : chunk.payload;
  return text.split('\n').map((line) => JSON.parse(line));
}

/**
 * Merge chunks into an event list, reporting integrity problems.
 * Duplicated chunks (retries) are tolerated; missing chunk indices and seq gaps
 * are reported so export can flag incomplete sessions.
 */
export function readChunks(chunks) {
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
    const decoded = decodeChunk(chunk);
    if (decoded.length !== chunk.n_events) {
      issues.push(`chunk ${chunk.i}: n_events ${chunk.n_events} != ${decoded.length} decoded`);
    }
    if (lastSeq !== null && decoded.length && decoded[0].seq !== lastSeq + 1) {
      issues.push(`seq gap before chunk ${chunk.i}: ${lastSeq} -> ${decoded[0].seq}`);
    }
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
