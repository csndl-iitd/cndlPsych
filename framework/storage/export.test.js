import { describe, expect, it } from 'vitest';
import { unzip, unzipBytes } from '../../tools/unzip.js';
import { crc32, deviceCaptureFiles, eventsCsv, eventsJsonl, sessionArchive, SUPPORTED_FORMATS, webcamFiles, zip } from './export.js';

const events = [
  { v: 1, seq: 0, t: 1.5, source: 'system', type: 'session.start', data: { profile: 'phone' }, block: null, trial: null, phase: null, caused_by: null },
  { v: 1, seq: 1, t: 2.5, t_bus: 4, source: 'task', type: 'phase.onset', data: { stimulus: 'Ǝ "x", y\nz' }, block: 'b1', trial: 1, phase: 'p', caused_by: 0 },
];

describe('crc32', () => {
  it.each([['', 0], ['a', 0xe8b7be43], ['123456789', 0xcbf43926], ['The quick brown fox jumps over the lazy dog', 0x414fa339]])('%j', (text, expected) => {
    expect(crc32(new TextEncoder().encode(text))).toBe(expected);
  });
});

describe('eventsJsonl', () => {
  it('is one JSON event per line, and empty for no events', () => {
    const text = eventsJsonl(events);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trim().split('\n').map((line) => JSON.parse(line))).toEqual(events);
    expect(eventsJsonl([])).toBe('');
  });
});

describe('eventsCsv', () => {
  it('has a header and one row per event, quoting cells that need it', () => {
    const rows = eventsCsv(events).split('\r\n');
    expect(rows[0]).toBe('seq,t,t_bus,source,type,block,trial,phase,caused_by,data');
    expect(rows[1]).toBe('0,1.5,,system,session.start,,,,,"{""profile"":""phone""}"');
    expect(rows[2].startsWith('1,2.5,4,task,phase.onset,b1,1,p,0,')).toBe(true);
    expect(rows[2]).toContain(String.raw`\n`);
    expect(rows.at(-1)).toBe('');
  });
});

describe('zip', () => {
  it('writes a valid archive that an independent reader can open, with correct CRCs', () => {
    const files = unzip(zip([{ name: 'a.txt', data: 'hello' }, { name: 'dir/Ǝ.bin', data: Uint8Array.of(0, 1, 2, 255) }, { name: 'empty', data: '' }]));
    expect(Object.keys(files)).toEqual(['a.txt', 'dir/Ǝ.bin', 'empty']);
    expect(files['a.txt']).toBe('hello');
    expect(files.empty).toBe('');
  });

  it('handles a large file', () => {
    const big = 'x'.repeat(300_000);
    expect(unzip(zip([{ name: 'big.txt', data: big }]))['big.txt']).toHaveLength(300_000);
  });
});

describe('sessionArchive', () => {
  const record = { subject_id: 'sub-007', session_id: 'ses-01', status: 'complete' };

  it('packs session.json and the requested formats under a name from the ids', () => {
    const archive = sessionArchive(record, events, ['jsonl', 'csv']);
    expect(archive.name).toBe('sub-007_ses-01.zip');
    const files = unzip(archive.data);
    expect(Object.keys(files)).toEqual(['session.json', 'events.jsonl', 'events.csv']);
    expect(JSON.parse(files['session.json'])).toEqual(record);
    expect(files['events.jsonl']).toBe(eventsJsonl(events));
    expect(archive.skipped).toEqual([]);
  });

  it('skips formats it cannot write and says so', () => {
    const archive = sessionArchive(record, events, ['jsonl', 'parquet']);
    expect(archive.skipped).toEqual(['parquet']);
    expect(Object.keys(unzip(archive.data))).toEqual(['session.json', 'events.jsonl']);
    expect(SUPPORTED_FORMATS).toEqual(['jsonl', 'csv', 'bids']);
  });
});

describe('webcam video the browser kept', () => {
  const piece = (segment, index, bytes, type = 'video/webm;codecs=vp9') => ({ segment, index, blob: new Blob([new Uint8Array(bytes)], { type }) });
  const record = { subject_id: 'sub-007', session_id: 'ses-01' };
  const bytesOf = async (file) => [...new Uint8Array(await file.blob.arrayBuffer())];

  it('joins the pieces of each recording in order, one file per recording', async () => {
    const files = webcamFiles(record, [piece(1, 0, [1, 2]), piece(1, 1, [3]), piece(2, 0, [9, 9])]);
    expect(files.map((f) => f.name)).toEqual(['sub-007_ses-01_webcam.webm', 'sub-007_ses-01_webcam-2.webm']);
    expect(await Promise.all(files.map(bytesOf))).toEqual([[1, 2, 3], [9, 9]]);
    expect(files[0].blob.type).toBe('video/webm;codecs=vp9');
  });

  it('names an mp4 recording as mp4, and has no files when nothing was recorded', () => {
    expect(webcamFiles(record, [piece(1, 0, [1], 'video/mp4')])[0].name).toBe('sub-007_ses-01_webcam.mp4');
    expect(webcamFiles(record, [])).toEqual([]);
  });

  it('is not in the zip', () => {
    const stored = unzipBytes(sessionArchive(record, [], ['jsonl']).data);
    expect(Object.keys(stored)).toEqual(['session.json', 'events.jsonl']);
  });
});

describe('deviceCaptureFiles', () => {
  const piece = (segment, index, chunks, bytes) => ({ segment, index, chunks, data: Uint8Array.from(bytes) });
  const text = (file) => (typeof file.data === 'string' ? file.data : new TextDecoder().decode(file.data));

  it('writes per sink the bytes received, the bytes written and an index that finds each chunk', () => {
    const files = deviceCaptureFiles([
      piece(1, 0, [{ sink: 'rx', dir: 'rx', t: 10.5, n: 3 }, { sink: 'rx', dir: 'tx', t: 12, n: 1 }, { sink: 'rx', dir: 'rx', t: 13, n: 2 }], [1, 2, 3, 9, 4, 5]),
      piece(2, 0, [{ sink: 'rx', dir: 'rx', t: 1, n: 1 }, { sink: 'other', dir: 'rx', t: 2, n: 1 }], [6, 7]),
    ]);
    const byName = Object.fromEntries(files.map((file) => [file.name, file]));
    expect(Object.keys(byName)).toEqual(['device/rx_rx.bin', 'device/rx_tx.bin', 'device/rx_index.csv', 'device/other_rx.bin', 'device/other_tx.bin', 'device/other_index.csv']);
    expect([...byName['device/rx_rx.bin'].data]).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...byName['device/rx_tx.bin'].data]).toEqual([9]);
    expect(text(byName['device/rx_index.csv'])).toBe(['segment,seq,dir,t_ms,offset,length', '1,0,rx,10.5,0,3', '1,1,tx,12,0,1', '1,2,rx,13,3,2', '2,3,rx,1,5,1', ''].join('\r\n'));
    expect([...byName['device/other_rx.bin'].data]).toEqual([7]);
  });

  it('is nothing for no capture, and the files go into the zip as they are', () => {
    expect(deviceCaptureFiles([])).toEqual([]);
    const archive = sessionArchive({ subject_id: 's', session_id: 'x' }, events, ['jsonl'], deviceCaptureFiles([piece(1, 0, [{ sink: 'rx', dir: 'rx', t: 1, n: 2 }], [8, 9])]));
    const files = unzip(archive.data);
    expect(Object.keys(files)).toEqual(['session.json', 'events.jsonl', 'device/rx_rx.bin', 'device/rx_tx.bin', 'device/rx_index.csv']);
  });
});
