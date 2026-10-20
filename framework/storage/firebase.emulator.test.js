// The Firebase client (allocator, chunk writer, finalization) against the real Firestore
// emulator with the generated rules loaded, so client and rules are tested together.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { allocateSubject, connectFirebase, createFirebaseStore, loadSdk, subjectSessions, suggestSubject } from './firebase.js';
import { integrityReport } from './integrity.js';

const ROOT = join(import.meta.dirname, '..', '..');
const EXP = 'oddball-2026';
const ADMIN = { sub: 'admin-uid', email: 'admin@lab.example', email_verified: true };
const sample = JSON.parse(readFileSync(join(ROOT, 'spec', 'examples', 'session.sample.json'), 'utf8'));
const events = readFileSync(join(ROOT, 'spec', 'examples', 'events.sample.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const host = process.env.CNDLPSYCH_FIRESTORE_HOST;
const port = Number(process.env.CNDLPSYCH_FIRESTORE_PORT);
const sdk = await loadSdk();

const environments = {};
let counter = 0;

async function environment(access) {
  const projectId = `demo-cndlpsych-client-${access}`;
  environments[access] = await initializeTestEnvironment({
    projectId,
    firestore: { host, port, rules: readFileSync(join(ROOT, 'spec', 'firebase', `firestore.${access}.rules`), 'utf8') },
  });
  return projectId;
}
afterAll(async () => { await Promise.all(Object.values(environments).map((env) => env.cleanup())); });

const configFor = (projectId, access, chunk = {}) => ({
  enabled: true, experiment_id: EXP, access, web_config: { apiKey: 'fake', projectId, appId: 'fake' }, chunk,
});
const connect = (config, token) => connectFirebase({ config, sdk, emulator: { host, port, token }, appName: `app-${counter += 1}-${token.sub}` });

const recordFor = (label, extra = {}) => {
  const { end_reason: _e, last_seq: _l, n_chunks: _n, ...rest } = sample;
  return { ...rest, subject_id: label, session_id: 'ses-01', status: 'in_progress', ended_at: null, ...extra };
};
const finishedRecord = (record, lastSeq) => ({ ...record, status: 'complete', ended_at: '2026-10-01T09:30:00Z', end_reason: 'complete', last_seq: lastSeq });

/** What an experimenter's export would read: everything stored for one session, rules bypassed. */
async function readBack(access, uid, label) {
  let out;
  await environments[access].withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const key = `${label}_ses-01`;
    const session = (await db.doc(`experiments/${EXP}/data/${uid}/sessions/${key}`).get()).data();
    const chunks = (await db.collection(`experiments/${EXP}/data/${uid}/sessions/${key}/chunks`).get()).docs.map((d) => d.data());
    const claims = (await db.collection(`experiments/${EXP}/claims`).get()).docs.map((d) => d.data());
    out = { session, chunks, claims };
  });
  return out;
}

describe('public mode', () => {
  const ACCESS = 'public';
  let projectId;
  let config;
  beforeAll(async () => { projectId = await environment('public'); config = configFor(projectId, 'public', { max_events: 10, flush_ms: 500 }); });
  beforeEach(async () => {
    await environments.public.clearFirestore();
    await environments.public.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`experiments/${EXP}/admins/${ADMIN.email}`).set({ added: true }));
  });

  it('50 parallel participants get unique, contiguous subject numbers', async () => {
    const connections = await Promise.all(Array.from({ length: 50 }, (_, i) => connect(config, { sub: `anon-${i}` })));
    const results = await Promise.all(connections.map((connection) => allocateSubject(connection)));
    const numbers = results.map((r) => r.n).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(results.map((r) => r.label)).size).toBe(50);
  }, 120_000);

  it('a reload (same uid) keeps the number instead of taking another', async () => {
    const first = await allocateSubject(await connect(config, { sub: 'anon-a' }));
    const again = await allocateSubject(await connect(config, { sub: 'anon-a' }));
    const other = await allocateSubject(await connect(config, { sub: 'anon-b' }));
    expect(again).toMatchObject({ n: first.n, reused: true });
    expect(other.n).toBe(first.n + 1);
  });

  it('writes a whole session: claim active then complete, chunks readable, nothing partial', async () => {
    const connection = await connect(config, { sub: 'anon-s' });
    const claim = await allocateSubject(connection);
    const store = createFirebaseStore({ connection, claim, config });
    const record = recordFor(claim.label);
    store.begin(record);
    events.forEach((event) => store.append(event));
    await store.finish(finishedRecord(record, events.at(-1).seq));

    const stored = await readBack(ACCESS, 'anon-s', claim.label);
    expect(stored.claims).toMatchObject([{ n: 1, label: 'sub-001', status: 'complete' }]);
    expect(stored.session).toMatchObject({ status: 'complete', uid: 'anon-s', experiment_id: EXP, n_chunks: stored.chunks.length, last_seq: events.at(-1).seq });
    expect(stored.chunks.length).toBe(Math.ceil(events.length / 10));
    const report = await integrityReport(stored.session, stored.chunks);
    expect(report).toMatchObject({ partial: false, issues: [] });
    expect(report.events).toEqual(events);
  });

  it('a crash leaves chunks and an in_progress session, which the integrity report calls partial', async () => {
    const connection = await connect(config, { sub: 'anon-c' });
    const claim = await allocateSubject(connection);
    const store = createFirebaseStore({ connection, claim, config });
    store.begin(recordFor(claim.label));
    events.slice(0, 35).forEach((event) => store.append(event));
    await store.flush(); // the page dies here: no finish()

    const stored = await readBack(ACCESS, 'anon-c', claim.label);
    expect(stored.session.status).toBe('in_progress');
    expect(stored.session.n_chunks).toBeUndefined();
    expect(stored.chunks.length).toBe(4);
    const report = await integrityReport(stored.session, stored.chunks);
    expect(report.partial).toBe(true);
    expect(report.events).toEqual(events.slice(0, 35));
  });

  it('retries a failed chunk write at the next flush and ends up complete', async () => {
    const connection = await connect(config, { sub: 'anon-r' });
    const claim = await allocateSubject(connection);
    let offline = true;
    const realPut = connection.ops.putChunk;
    connection.ops.putChunk = (key, chunk) => (offline ? Promise.reject(Object.assign(new Error('offline'), { code: 'unavailable' })) : realPut(key, chunk));
    const statuses = [];
    const store = createFirebaseStore({ connection, claim, config, retryDelayMs: 1 });
    store.onStatus((status) => statuses.push(status.state));
    const record = recordFor(claim.label);
    store.begin(record);
    events.slice(0, 10).forEach((event) => store.append(event));
    await store.flush();
    expect(store.pendingChunks).toBe(1);
    expect(statuses).toContain('degraded');
    offline = false;
    await store.finish(finishedRecord(record, events[9].seq));
    expect(store.pendingChunks).toBe(0);
    const stored = await readBack(ACCESS, 'anon-r', claim.label);
    expect((await integrityReport(stored.session, stored.chunks)).partial).toBe(false);
  });

  it('a chunk sent twice (retry after a lost acknowledgement) is accepted and stays single', async () => {
    const connection = await connect(config, { sub: 'anon-d' });
    const claim = await allocateSubject(connection);
    const record = recordFor(claim.label);
    await connection.ops.createSession(`${claim.label}_ses-01`, { ...record, uid: 'anon-d', experiment_id: EXP, status: 'in_progress' });
    const { makeChunks } = await import('./chunks.js');
    const [chunk] = await makeChunks(events.slice(0, 5));
    await connection.ops.putChunk(`${claim.label}_ses-01`, chunk);
    await connection.ops.putChunk(`${claim.label}_ses-01`, chunk);
    expect((await readBack(ACCESS, 'anon-d', claim.label)).chunks).toHaveLength(1);
  });

  it('resumes after a crash: the in-flight chunk is rebuilt identically and nothing is lost or doubled', async () => {
    const connection = await connect(config, { sub: 'anon-x' });
    const claim = await allocateSubject(connection);
    const journal = { remote: null };
    const options = { connection, claim, config, onProgress: (remote) => { journal.remote = remote; } };

    const first = createFirebaseStore(options);
    const record = recordFor(claim.label);
    first.begin(record);
    events.slice(0, 25).forEach((event) => first.append(event));
    await first.flush();
    // the page died after chunk 2 was recorded as pending but before it was acknowledged:
    // simulate by claiming chunk 2 (events 20..24) is still in flight, though it did arrive.
    journal.remote = { next_chunk: 2, uploaded_seq: events[19].seq, pending: { i: 2, from_seq: events[20].seq, to_seq: events[24].seq } };

    const second = createFirebaseStore({ ...options, onProgress: () => {} });
    second.resume(record, journal.remote, events.slice(0, 35));
    await second.finish(finishedRecord(record, events[34].seq));

    const stored = await readBack(ACCESS, 'anon-x', claim.label);
    const report = await integrityReport(stored.session, stored.chunks);
    expect(report).toMatchObject({ partial: false, issues: [] });
    expect(report.events).toEqual(events.slice(0, 35));
  });

  it('reports a rejected session (a bad record) as an error and keeps going without throwing', async () => {
    const connection = await connect(config, { sub: 'anon-e' });
    const claim = await allocateSubject(connection);
    const store = createFirebaseStore({ connection, claim, config });
    const statuses = [];
    store.onStatus((status) => statuses.push(status));
    store.begin(recordFor('sub-999')); // not the number this user claimed
    store.append(events[0]);
    await store.finish(finishedRecord(recordFor('sub-999'), 0));
    expect(statuses.map((s) => s.state)).toContain('error');
    expect(store.broken).toBe(true);
  });
});

describe('controlled mode', () => {
  const ACCESS = 'controlled';
  let projectId;
  let config;
  beforeAll(async () => { projectId = await environment('controlled'); config = configFor(projectId, 'controlled'); });
  beforeEach(async () => {
    await environments.controlled.clearFirestore();
    await environments.controlled.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`experiments/${EXP}/admins/${ADMIN.email}`).set({ added: true }));
  });

  it('suggests the smallest free number, creates it, and fills gaps', async () => {
    const connection = await connect(config, ADMIN);
    expect(await suggestSubject(connection)).toEqual({ n: 1, label: 'sub-001' });
    await allocateSubject(connection);
    await allocateSubject(connection, { override: 3 });
    expect(await suggestSubject(connection)).toEqual({ n: 2, label: 'sub-002' });
    expect((await allocateSubject(connection)).n).toBe(2);
  });

  it('refuses a number that is taken', async () => {
    const connection = await connect(config, ADMIN);
    await allocateSubject(connection, { override: 5 });
    await expect(allocateSubject(connection, { override: 5 })).rejects.toThrow('already taken');
  });

  it('two experimenters racing for the suggested number both succeed with different numbers', async () => {
    const other = { ...ADMIN, sub: 'admin-two' };
    const [a, b] = await Promise.all([connect(config, ADMIN), connect(config, other)]);
    const [x, y] = await Promise.all([allocateSubject(a), allocateSubject(b)]);
    expect([x.n, y.n].sort()).toEqual([1, 2]);
  });

  it('a non-admin cannot allocate or write', async () => {
    const connection = await connect(config, { sub: 'stranger', email: 'x@y.example', email_verified: true });
    await expect(allocateSubject(connection)).rejects.toThrow();
  });

  it('a number used again: its earlier sessions are found whoever ran them, the claim keeps its state, and the new session is written', async () => {
    const first = await connect(config, ADMIN);
    const claim = await allocateSubject(first);
    const store = createFirebaseStore({ connection: first, claim, config });
    const record = recordFor(claim.label);
    store.begin(record);
    events.slice(0, 12).forEach((event) => store.append(event));
    await store.finish(finishedRecord(record, events[11].seq));

    const second = await connect(config, { ...ADMIN, sub: 'admin-two' });
    const earlier = await subjectSessions(second, claim.label);
    expect(earlier.map((session) => session.session_id)).toEqual(['ses-01']);
    expect(earlier[0].subject).toEqual(sample.subject);

    const again = await allocateSubject(second, { override: claim.n, reuse: true });
    expect(again).toMatchObject({ n: claim.n, reused: true });
    const next = createFirebaseStore({ connection: second, claim: again, config });
    const nextRecord = recordFor(claim.label, { session_id: 'ses-02' });
    next.begin(nextRecord);
    events.slice(0, 12).forEach((event) => next.append(event));
    await next.finish(finishedRecord(nextRecord, events[11].seq));

    expect((await subjectSessions(first, claim.label)).map((session) => session.session_id).sort()).toEqual(['ses-01', 'ses-02']);
    expect((await readBack(ACCESS, ADMIN.sub, claim.label)).claims).toEqual([expect.objectContaining({ n: claim.n, status: 'complete' })]);
    expect(await subjectSessions(first, 'sub-099')).toEqual([]);
  });

  it('writes a whole session as the experimenter', async () => {
    const connection = await connect(config, ADMIN);
    const claim = await allocateSubject(connection);
    const store = createFirebaseStore({ connection, claim, config });
    const record = recordFor(claim.label);
    store.begin(record);
    events.slice(0, 12).forEach((event) => store.append(event));
    await store.finish(finishedRecord(record, events[11].seq));
    const stored = await readBack(ACCESS, ADMIN.sub, claim.label);
    expect(await integrityReport(stored.session, stored.chunks)).toMatchObject({ partial: false, issues: [] });
  });
});
