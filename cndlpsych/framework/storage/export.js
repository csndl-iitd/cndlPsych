// Turning a session (record + events) into files: JSONL, CSV, BIDS (storage/bids.js) and a
// store-only zip so one download carries everything. Pure and dependency free.
import { bidsFiles } from './bids.js';
import { eventsJsonl } from './jsonl.js';

export { eventsJsonl };
const encoder = new TextEncoder();

const CSV_COLUMNS = ['seq', 't', 't_bus', 'source', 'type', 'block', 'trial', 'phase', 'caused_by', 'data'];

function csvCell(value) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per event; the data object is one JSON cell. */
export function eventsCsv(events) {
  const rows = events.map((event) => CSV_COLUMNS.map((column) => csvCell(event[column])).join(','));
  return `${[CSV_COLUMNS.join(','), ...rows].join('\r\n')}\r\n`;
}

// ---- zip (method 0, no compression) --------------------------------------------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_DATE_1980 = (1 << 5) | 1; // 1980-01-01, the zip epoch; contents carry their own times

/**
 * @param {{name: string, data: string|Uint8Array}[]} files
 * @returns {Uint8Array} a zip archive (stored, UTF-8 names)
 */
export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, DOS_DATE_1980, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]
      .forEach(([at, value, size]) => (size === 4 ? local.setUint32(at, value, true) : local.setUint16(at, value, true)));
    parts.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, DOS_DATE_1980, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([at, value, size]) => (size === 4 ? entry.setUint32(at, value, true) : entry.setUint16(at, value, true)));
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, centralSize, 4], [16, offset, 4], [20, 0, 2]]
    .forEach(([at, value, size]) => (size === 4 ? end.setUint32(at, value, true) : end.setUint16(at, value, true)));
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

// ---- a session as downloadable files ------------------------------------------------------------
const EXPORTERS = {
  jsonl: (record, events) => [{ name: 'events.jsonl', data: eventsJsonl(events) }],
  csv: (record, events) => [{ name: 'events.csv', data: eventsCsv(events) }],
  bids: (record, events) => bidsFiles([{ record, events }], { prefix: 'bids/' }),
};

/** Formats this module can write. */
export const SUPPORTED_FORMATS = Object.keys(EXPORTERS);

/** File extension for a recorded video mime type. */
export const extensionOf = (mime) => (String(mime).startsWith('video/mp4') ? 'mp4' : 'webm');

/**
 * The webcam video the browser kept (storage in the browser, not a file on disk), one file per recording
 * (a resumed session has several). It is downloaded as its own files, never put in the zip.
 * The pieces of one recording, joined in order, are one playable file.
 * @param {object} record session record
 * @param {{segment: number, index: number, blob: Blob}[]} pieces from the store's readMedia(), in order
 * @returns {{name: string, blob: Blob}[]}
 */
export function webcamFiles(record, pieces) {
  return [...Map.groupBy(pieces, (piece) => piece.segment)].map(([segment, parts]) => ({
    name: `${record.subject_id}_${record.session_id}_webcam${segment > 1 ? `-${segment}` : ''}.${extensionOf(parts[0].blob.type)}`,
    blob: new Blob(parts.map((part) => part.blob), { type: parts[0].blob.type }),
  }));
}

/**
 * What a trigger device sent and was sent, uninterpreted: per sink, the bytes received (`<sink>_rx.bin`) and written
 * (`<sink>_tx.bin`) and an index of the chunks (`<sink>_index.csv`: segment, seq, dir, t_ms, offset, length). `t_ms` is the
 * session clock when the chunk arrived (rx) or when the write to the device began (tx); rows are in the order they were captured, so a write can follow a read that arrived while it was in progress; `offset` and `length` find it in the .bin of
 * its direction. A resumed session's chunks are a new `segment`, with their own clock anchor in the events.
 * @param {{segment: number, index: number, chunks: {sink: string, dir: 'rx'|'tx', t: number, n: number}[], data: Uint8Array}[]} pieces from the store's readStreams(), in order
 * @returns {{name: string, data: string|Uint8Array}[]}
 */
export function deviceCaptureFiles(pieces) {
  const sinks = new Map(); // id -> {rx: [], tx: [], offset: {rx, tx}, rows: []}
  for (const piece of pieces) {
    let at = 0;
    for (const chunk of piece.chunks) {
      const sink = sinks.get(chunk.sink) ?? { rx: [], tx: [], offset: { rx: 0, tx: 0 }, rows: [] };
      sinks.set(chunk.sink, sink);
      sink[chunk.dir].push(piece.data.subarray(at, at + chunk.n));
      sink.rows.push([piece.segment, sink.rows.length, chunk.dir, chunk.t, sink.offset[chunk.dir], chunk.n].join(','));
      sink.offset[chunk.dir] += chunk.n;
      at += chunk.n;
    }
  }
  const join = (parts, length) => {
    const out = new Uint8Array(length);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  };
  return [...sinks].flatMap(([id, sink]) => [
    { name: `device/${id}_rx.bin`, data: join(sink.rx, sink.offset.rx) },
    { name: `device/${id}_tx.bin`, data: join(sink.tx, sink.offset.tx) },
    { name: `device/${id}_index.csv`, data: `${['segment,seq,dir,t_ms,offset,length', ...sink.rows].join('\r\n')}\r\n` },
  ]);
}

/**
 * The files for one session, packed in a single zip named after the subject and session.
 * @param {object} record session record
 * @param {object[]} events
 * @param {string[]} formats entries of storage.local.export_on_finish; unsupported ones are skipped
 * @param {{name: string, data: string|Uint8Array}[]} [extraFiles] added as they are (the raw device data)
 * @returns {{name: string, data: Uint8Array, skipped: string[]}}
 */
export function sessionArchive(record, events, formats = ['jsonl'], extraFiles = []) {
  const wanted = formats.filter((format) => format in EXPORTERS);
  const files = [{ name: 'session.json', data: `${JSON.stringify(record, null, 2)}\n` }, ...wanted.flatMap((format) => EXPORTERS[format](record, events)), ...extraFiles];
  return { name: `${record.mode === 'test' ? 'test_' : ''}${record.subject_id}_${record.session_id}.zip`, data: zip(files), skipped: formats.filter((format) => !(format in EXPORTERS)) };
}
