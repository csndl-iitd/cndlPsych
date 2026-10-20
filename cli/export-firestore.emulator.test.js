// Export from Firestore, against the emulator: sessions are written by the real client code
// (with the generated rules loaded) and read back with the Admin SDK, as the CLI does.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { allocateSubject, connectFirebase, createFirebaseStore, loadSdk } from '../framework/storage/firebase.js';
import { bidsFiles } from '../framework/storage/bids.js';
import { datasetFiles, readSessions, writeFiles } from './export-firestore.js';

const ROOT = join(import.meta.dirname, '..');
const EXP = 'oddball-2026';
const PROJECT = 'demo-cndlpsych-export';
const sample = JSON.parse(readFileSync(join(ROOT, 'spec', 'examples', 'session.sample.json'), 'utf8'));
const events = readFileSync(join(ROOT, 'spec', 'examples', 'events.sample.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const host = process.env.CNDLPSYCH_FIRESTORE_HOST;
const port = Number(process.env.CNDLPSYCH_FIRESTORE_PORT);
const sdk = await loadSdk();
const config = { enabled: true, experiment_id: EXP, access: 'public', web_config: { apiKey: 'fake', projectId: PROJECT, appId: 'fake' }, chunk: { max_events: 10, flush_ms: 500 } };

let env;
let counter = 0;
let admin;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host, port, rules: readFileSync(join(ROOT, 'spec', 'firebase', 'firestore.public.rules'), 'utf8') } });
  process.env.FIRESTORE_EMULATOR_HOST = `${host}:${port}`;
  admin = getFirestore(getApps()[0] ?? initializeApp({ projectId: PROJECT }));
});
afterAll(async () => { await env.cleanup(); });
beforeEach(() => env.clearFirestore());

const recordFor = (label, extra = {}) => {
  const { end_reason: _e, last_seq: _l, n_chunks: _n, ...rest } = sample;
  return { ...rest, subject_id: label, session_id: 'ses-01', status: 'in_progress', ended_at: null, ...extra };
};
const finishedRecord = (record) => ({ ...record, status: 'complete', ended_at: '2026-09-30T10:41:10Z', end_reason: 'complete', last_seq: events.at(-1).seq });

/** A participant runs a session through the client; `finish: false` leaves it as a crash would. */
async function runSession(uid, { finish = true, count = events.length } = {}) {
  const connection = await connectFirebase({ config, sdk, emulator: { host, port, token: { sub: uid } }, appName: `export-${counter += 1}` });
  const claim = await allocateSubject(connection);
  const store = createFirebaseStore({ connection, claim, config });
  const record = recordFor(claim.label);
  store.begin(record);
  events.slice(0, count).forEach((event) => store.append(event));
  if (finish) await store.finish(finishedRecord(record));
  else await store.flush();
  return { record: finishedRecord(record), label: claim.label, uid };
}

describe('export from Firestore', () => {
  it('gives the same BIDS dataset as exporting the same session locally (apart from the Firestore-only fields of the record)', async () => {
    const { record } = await runSession('anon-a');
    const [session] = await readSessions(admin, EXP);
    expect(session).toMatchObject({ partial: false, issues: [] });
    expect(session.events).toEqual(events);

    const remote = new Map(datasetFiles([session], EXP).map((file) => [file.name, file.data]));
    const local = new Map(bidsFiles([{ record, events }]).map((file) => [file.name, file.data]));
    const comparable = [...local.keys()].filter((name) => !name.endsWith('session.json'));
    expect(comparable.length).toBeGreaterThan(5);
    for (const name of comparable) expect(remote.get(name), name).toBe(local.get(name));
    expect(JSON.parse(remote.get('sourcedata/sub-001/ses-01/session.json'))).toMatchObject({ uid: 'anon-a', experiment_id: EXP, status: 'complete', subject_id: 'sub-001' });
    expect(JSON.parse(remote.get('sourcedata/export-report.json')).sessions).toMatchObject([{ subject_id: 'sub-001', partial: false, issues: [], n_events: events.length }]);
  });

  it('exports an interrupted session, flags it, and writes INCOMPLETE.txt next to its data', async () => {
    await runSession('anon-b', { finish: false, count: 35 });
    const sessions = await readSessions(admin, EXP);
    expect(sessions[0]).toMatchObject({ partial: true });
    expect(sessions[0].issues[0]).toContain('never finished');
    expect(sessions[0].events).toEqual(events.slice(0, 35));
    const names = datasetFiles(sessions, EXP).map((file) => file.name);
    expect(names).toContain('sourcedata/sub-001/ses-01/INCOMPLETE.txt');
    expect(names).toContain('sub-001/ses-01/beh/sub-001_ses-01_task-Oddballflashesandvisualsearch_events.tsv');
  });

  it('catches a missing chunk and the seq gap it leaves', async () => {
    const { uid, label } = await runSession('anon-c');
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`experiments/${EXP}/data/${uid}/sessions/${label}_ses-01/chunks/1`).delete());
    const [session] = await readSessions(admin, EXP);
    expect(session.partial).toBe(true);
    expect(session.issues.some((issue) => issue.includes('missing chunk'))).toBe(true);
    expect(session.issues.some((issue) => issue.includes('chunk 1 of'))).toBe(true);
    expect(session.issues.some((issue) => issue.includes('seq gap'))).toBe(true);
    expect(session.events.length).toBe(events.length - 10);
  });

  it('catches a missing last chunk, which only the session record can reveal', async () => {
    const { uid, label } = await runSession('anon-d');
    const last = Math.ceil(events.length / 10) - 1;
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc(`experiments/${EXP}/data/${uid}/sessions/${label}_ses-01/chunks/${last}`).delete());
    const [session] = await readSessions(admin, EXP);
    expect(session.issues.some((issue) => issue.includes(`chunk ${last} of`))).toBe(true);
  });

  it('exports several participants, oldest first, ignoring other experiments, and writes the files', async () => {
    await runSession('anon-e');
    await runSession('anon-f');
    await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc('experiments/other/data/x/sessions/sub-001_ses-01').set({ ...recordFor('sub-001'), experiment_id: 'other', uid: 'x' }));
    const sessions = await readSessions(admin, EXP);
    expect(sessions.map((s) => s.record.subject_id)).toEqual(['sub-001', 'sub-002']);
    const out = mkdtempSync(join(tmpdir(), 'cndlpsych-export-'));
    try {
      writeFiles(out, datasetFiles(sessions, EXP));
      expect(readFileSync(join(out, 'participants.tsv'), 'utf8').trim().split('\n').map((line) => line.split('\t')[0])).toEqual(['participant_id', 'sub-001', 'sub-002']);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
