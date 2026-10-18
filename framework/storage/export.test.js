import { describe, expect, it } from 'vitest';
import { unzip, unzipBytes } from '../../tools/unzip.js';
import { crc32, eventsCsv, eventsJsonl, sessionArchive, SUPPORTED_FORMATS, webcamFiles, zip } from './export.js';

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

describe('webcam video in the archive', () => {
  const piece = (segment, index, bytes, type = 'video/webm;codecs=vp9') => ({ segment, index, blob: new Blob([new Uint8Array(bytes)], { type }) });
  const record = { subject_id: 'sub-007', session_id: 'ses-01' };

  it('joins the pieces of each recording in order, one file per recording', async () => {
    const files = await webcamFiles(record, [piece(1, 0, [1, 2]), piece(1, 1, [3]), piece(2, 0, [9, 9])]);
    expect(files.map((f) => [f.name, [...f.data]])).toEqual([
      ['webcam/sub-007_ses-01_segment-1.webm', [1, 2, 3]],
      ['webcam/sub-007_ses-01_segment-2.webm', [9, 9]],
    ]);
  });

  it('names an mp4 recording as mp4, and has no files when nothing was recorded', async () => {
    expect((await webcamFiles(record, [piece(1, 0, [1], 'video/mp4')]))[0].name).toBe('webcam/sub-007_ses-01_segment-1.mp4');
    expect(await webcamFiles(record, [])).toEqual([]);
  });

  it('puts the video into the zip byte for byte', async () => {
    const video = await webcamFiles(record, [piece(1, 0, [0, 255, 128, 10, 13])]);
    const archive = sessionArchive(record, [], ['jsonl'], video);
    const stored = unzipBytes(archive.data);
    expect([...stored['webcam/sub-007_ses-01_segment-1.webm']]).toEqual([0, 255, 128, 10, 13]);
    expect(Object.keys(stored)).toEqual(['session.json', 'events.jsonl', 'webcam/sub-007_ses-01_segment-1.webm']);
  });
});
