import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeChunks } from './chunks.js';
import { integrityReport } from './integrity.js';

const EXAMPLES = join(import.meta.dirname, '..', '..', 'spec', 'examples');
const events = readFileSync(join(EXAMPLES, 'events.sample.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const finished = (chunks) => ({ status: 'complete', n_chunks: chunks.length, last_seq: events.at(-1).seq });

describe('integrityReport', () => {
  it('a finished session whose chunks add up is not partial', async () => {
    const chunks = await makeChunks(events, { maxEvents: 10 });
    expect(await integrityReport(finished(chunks), chunks)).toMatchObject({ partial: false, issues: [] });
  });

  it('flags a session that never finished, but still returns its events', async () => {
    const chunks = await makeChunks(events.slice(0, 20), { maxEvents: 10 });
    const report = await integrityReport({ status: 'in_progress' }, chunks);
    expect(report.partial).toBe(true);
    expect(report.issues[0]).toContain('never finished');
    expect(report.events).toEqual(events.slice(0, 20));
  });

  it('flags a missing chunk, from the index gap and from the record', async () => {
    const chunks = await makeChunks(events, { maxEvents: 10 });
    const report = await integrityReport(finished(chunks), chunks.filter((chunk) => chunk.i !== 1));
    expect(report.partial).toBe(true);
    expect(report.issues.some((m) => m.includes('chunk 1 of'))).toBe(true);
  });

  it('flags a missing last chunk that only the record can reveal', async () => {
    const chunks = await makeChunks(events, { maxEvents: 10 });
    const report = await integrityReport(finished(chunks), chunks.slice(0, -1));
    expect(report.issues.some((m) => m.includes(`chunk ${chunks.length - 1} of`))).toBe(true);
    expect(report.issues.some((m) => m.includes('the last event is seq'))).toBe(true);
  });

  it('reports a duplicated chunk without calling the session partial', async () => {
    const chunks = await makeChunks(events, { maxEvents: 10 });
    const report = await integrityReport(finished(chunks), [...chunks, chunks[2]]);
    expect(report.issues).toEqual(['duplicate chunk 2']);
    expect(report.partial).toBe(false);
  });

  it('flags a seq gap', async () => {
    const chunks = await makeChunks(events, { maxEvents: 10 });
    const report = await integrityReport({ status: 'complete', n_chunks: 2, last_seq: 29 }, [chunks[0], { ...(await makeChunks(events.slice(12, 22), { firstIndex: 1 }))[0] }]);
    expect(report.issues.some((m) => m.includes('seq gap'))).toBe(true);
    expect(report.partial).toBe(true);
  });
});
