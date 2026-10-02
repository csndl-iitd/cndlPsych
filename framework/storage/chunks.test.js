import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { problemsFor } from '../../tools/validators.js';
import { asciiJson, decodeChunk, encodeChunk, hasNestedArray, makeChunks, readChunks } from './chunks.js';

const EXAMPLES = join(import.meta.dirname, '..', '..', 'spec', 'examples');
const events = readFileSync(join(EXAMPLES, 'events.sample.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const sample = JSON.parse(readFileSync(join(EXAMPLES, 'firestore.sample.json'), 'utf8'));
const chunkProblems = problemsFor('firestore.schema.json', '#/definitions/chunk');
const sampleChunks = Object.entries(sample).filter(([key]) => key.includes('/chunks/')).map(([, value]) => value);

describe('parity with the Python reference (spec/examples/firestore.sample.json)', () => {
  it('decodes the reference chunks to the sample events', async () => {
    const decoded = await Promise.all(sampleChunks.map(decodeChunk));
    expect(decoded.flat()).toEqual(events.slice(0, 6));
  });

  it('writes the same chunk documents: same indices, counts, seq and time bounds, same events', async () => {
    const mine = await makeChunks(events.slice(0, 6), { maxEvents: 3 });
    expect(mine.map(({ payload: _payload, ...rest }) => rest)).toEqual(sampleChunks.map(({ payload: _payload, ...rest }) => rest));
    expect(await Promise.all(mine.map(decodeChunk))).toEqual(await Promise.all(sampleChunks.map(decodeChunk)));
  });

  it('differs from Python only in how integral floats print (1211 vs 1211.0)', async () => {
    const [mine] = await makeChunks(events.slice(3, 6), { maxEvents: 3 });
    expect(sampleChunks[1].payload).toContain('"t":1211.0');
    expect(mine.payload).toContain('"t":1211,');
    expect(JSON.parse(mine.payload.split('\n')[0])).toEqual(JSON.parse(sampleChunks[1].payload.split('\n')[0]));
  });

  it('the reference chunks pass the chunk schema and a reader finds no integrity issue', async () => {
    for (const chunk of sampleChunks) expect(chunkProblems(chunk)).toEqual([]);
    expect((await readChunks(sampleChunks)).issues).toEqual([]);
  });
});

describe.each(['json', 'gzip-base64'])('%s encoding', (encoding) => {
  it('chunks validate against the chunk schema, are numbered from 0 and respect the event limit', async () => {
    const chunks = await makeChunks(events, { maxEvents: 10, encoding });
    expect(chunks.flatMap((chunk) => chunkProblems(chunk))).toEqual([]);
    expect(chunks.map((c) => c.i)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.n_events <= 10)).toBe(true);
    expect(chunks.reduce((sum, c) => sum + c.n_events, 0)).toBe(events.length);
  });

  it('round-trips to the original events with no integrity issue', async () => {
    const { events: back, issues } = await readChunks(await makeChunks(events, { maxEvents: 10, encoding }));
    expect(issues).toEqual([]);
    expect(back).toEqual(events);
  });

  it('keeps ASCII-only payloads, so string length is byte size (the rules\' size() check)', async () => {
    const odd = { ...events[0], data: { ...events[0].data, note: 'Ǝ \u{1f600}' } };
    const [chunk] = await makeChunks([odd], { encoding });
    expect([...chunk.payload].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    expect((await readChunks([chunk])).events).toEqual([odd]);
  });
});

describe('gzip-base64', () => {
  it('is a real gzip stream that an independent decoder reads', async () => {
    const chunk = await encodeChunk(events.slice(0, 5), 0, 'gzip-base64');
    const text = gunzipSync(Buffer.from(chunk.payload, 'base64')).toString('ascii');
    expect(text.split('\n').map((line) => JSON.parse(line))).toEqual(events.slice(0, 5));
    expect(chunk.payload.length).toBeLessThan(asciiJson(events.slice(0, 5)).length * 2);
  });

  it('shrinks a repetitive stream a lot, and splits on the compressed-size bound', async () => {
    const big = Array.from({ length: 300 }, (_, seq) => ({ ...events[1], seq, data: { ...events[1].data, pad: 'abc'.repeat(200) } }));
    const [plain] = await makeChunks(big, { maxEvents: 300, maxBytes: 900_000 });
    const [packed] = await makeChunks(big, { maxEvents: 300, maxBytes: 900_000, encoding: 'gzip-base64' });
    expect(packed.payload.length).toBeLessThan(plain.payload.length / 5);
    const many = await makeChunks(big, { maxEvents: 5000, maxBytes: 20_000, encoding: 'gzip-base64' });
    expect(many.length).toBeGreaterThan(1);
    expect(many.every((chunk) => chunk.payload.length <= 20_000)).toBe(true);
  });
});

describe('limits and integrity', () => {
  it('splits on the byte limit', async () => {
    const small = await makeChunks(events, { maxEvents: 5000, maxBytes: 2500 });
    expect(small.length).toBeGreaterThan(1);
    expect(small.every((c) => c.payload.length <= 2500)).toBe(true);
  });

  it('refuses a single event larger than the limit', async () => {
    const huge = { ...events[0], data: { blob: 'x'.repeat(5000) } };
    await expect(makeChunks([huge], { maxBytes: 2500 })).rejects.toThrow(/exceeds the chunk limit/);
  });

  it('numbers chunks from firstIndex (a resumed session continues its indices)', async () => {
    const chunks = await makeChunks(events.slice(10, 30), { maxEvents: 10, firstIndex: 7 });
    expect(chunks.map((c) => c.i)).toEqual([7, 8]);
  });

  it('reports a missing chunk, tolerates a retried duplicate, and reports a seq gap', async () => {
    const chunks = await makeChunks(events, { maxEvents: 10 });
    expect((await readChunks([chunks[0], ...chunks.slice(2)])).issues.some((m) => m.includes('missing chunk'))).toBe(true);
    const duplicated = (await readChunks([...chunks, chunks[1]])).issues;
    expect(duplicated.some((m) => m.includes('duplicate'))).toBe(true);
    expect(duplicated.some((m) => m.includes('missing'))).toBe(false);
    const gapped = [chunks[0], { ...chunks[1], i: 1, from_seq: 99 }];
    gapped[1] = await encodeChunk(events.slice(12, 15), 1);
    expect((await readChunks(gapped)).issues.some((m) => m.includes('seq gap'))).toBe(true);
  });

  it('reports a chunk whose n_events does not match its payload', async () => {
    const [chunk] = await makeChunks(events.slice(0, 3));
    expect((await readChunks([{ ...chunk, n_events: 4 }])).issues[0]).toContain('n_events 4 != 3');
  });
});

describe('asciiJson and hasNestedArray', () => {
  it('escapes non-ASCII like Python ensure_ascii, with surrogate pairs and lowercase hex', () => {
    expect(asciiJson({ a: 'Ǝ' })).toBe('{"a":"\\u018e"}');
    expect(asciiJson('\u{1f600}')).toBe('"\\ud83d\\ude00"');
    expect(asciiJson('DEL\u007f')).toBe('"DEL\u007f"');
  });

  it('finds arrays directly inside arrays, and only those', () => {
    expect(hasNestedArray([[1, 2]])).toBe(true);
    expect(hasNestedArray({ samples: [[1, 2, 3]] })).toBe(true);
    expect(hasNestedArray({ a: [{ b: [1] }] })).toBe(false);
    expect(hasNestedArray([1, 2, 3])).toBe(false);
  });

  it('the sample contains nested-array events that Firestore would reject, which is why chunks are strings', () => {
    expect(events.filter((event) => hasNestedArray(event)).length).toBeGreaterThanOrEqual(2);
  });
});
