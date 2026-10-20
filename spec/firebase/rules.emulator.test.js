// The rules test matrix from DESIGN.md, run against the real Firestore emulator.
// These tests do not use the framework's client code: they speak to Firestore directly, so
// they check the rules themselves.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeChunks } from '../../framework/storage/chunks.js';

const SPEC = join(import.meta.dirname, '..');
const EXP = 'oddball-2026';
const ADMIN = { email: 'admin@lab.example', email_verified: true };
const sessionSample = JSON.parse(readFileSync(join(SPEC, 'examples', 'session.sample.json'), 'utf8'));
const events = readFileSync(join(SPEC, 'examples', 'events.sample.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const now = () => firebase.firestore.FieldValue.serverTimestamp();

const environments = {};
async function environment(mode) {
  environments[mode] = await initializeTestEnvironment({
    projectId: `demo-cndlpsych-${mode}`,
    firestore: { host: process.env.CNDLPSYCH_FIRESTORE_HOST, port: Number(process.env.CNDLPSYCH_FIRESTORE_PORT), rules: readFileSync(join(SPEC, 'firebase', `firestore.${mode}.rules`), 'utf8') },
  });
  return environments[mode];
}

afterAll(async () => { await Promise.all(Object.values(environments).map((env) => env.cleanup())); });

// ---- builders -------------------------------------------------------------------------
const path = (suffix) => `experiments/${EXP}/${suffix}`;
const claimDoc = (n, label = `sub-${String(n).padStart(3, '0')}`) => ({ n, label, status: 'reserved', created_at: now() });
const markerDoc = (n) => ({ n, created_at: now() });

function sessionDoc(uid, { subject = 'sub-001', session = 'ses-01', ...extra } = {}) {
  const { end_reason: _e, last_seq: _l, n_chunks: _n, ...rest } = sessionSample;
  return { ...rest, status: 'in_progress', ended_at: null, subject_id: subject, session_id: session, uid, experiment_id: EXP, ...extra };
}
const sessionPath = (uid, key = 'sub-001_ses-01') => path(`data/${uid}/sessions/${key}`);
const CHUNKS = await makeChunks(events, { maxEvents: 5 });
const chunkDoc = (i = 0) => ({ ...CHUNKS[i], i });

/** Public mode: user `uid` claims number n (claim + marker in one batch). */
async function claim(db, uid, n) {
  const batch = db.batch();
  batch.set(db.doc(path(`claims/${n}`)), claimDoc(n));
  batch.set(db.doc(path(`claims_by_uid/${uid}`)), markerDoc(n));
  await batch.commit();
}

const seed = (env, fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
const addAdmin = (env, email = ADMIN.email) => seed(env, (db) => db.doc(path(`admins/${email}`)).set({ added: true }));
const anon = (env, uid) => env.authenticatedContext(uid).firestore();
const admin = (env, uid = 'admin-uid') => env.authenticatedContext(uid, ADMIN).firestore();

describe('public mode', () => {
  let env;
  beforeAll(async () => { env = await environment('public'); });
  beforeEach(async () => { await env.clearFirestore(); await addAdmin(env); });

  describe('subject-number claims', () => {
    it('1. anon A creates claim 1 and its marker in one batch: allowed', async () => {
      await assertSucceeds(claim(anon(env, 'A'), 'A', 1));
    });

    it('2. claim 1 without the marker: denied', async () => {
      await assertFails(anon(env, 'A').doc(path('claims/1')).set(claimDoc(1)));
    });

    it('3. anon B creates claim 1 again: denied', async () => {
      await claim(anon(env, 'A'), 'A', 1);
      await assertFails(claim(anon(env, 'B'), 'B', 1));
    });

    it('4. anon B creates claim 3 while 2 is missing: denied (no gaps)', async () => {
      await claim(anon(env, 'A'), 'A', 1);
      await assertFails(claim(anon(env, 'B'), 'B', 3));
      await assertSucceeds(claim(anon(env, 'B'), 'B', 2));
    });

    it('5. anon A takes a second claim although its marker exists: denied', async () => {
      await claim(anon(env, 'A'), 'A', 1);
      await assertFails(claim(anon(env, 'A'), 'A', 2));
      await assertFails(anon(env, 'A').doc(path('claims/2')).set(claimDoc(2)));
    });

    it('a claim with a wrong label, status or id is denied', async () => {
      const db = anon(env, 'A');
      const batch = (doc) => { const b = db.batch(); b.set(db.doc(path('claims/1')), doc); b.set(db.doc(path('claims_by_uid/A')), markerDoc(1)); return b.commit(); };
      await assertFails(batch({ ...claimDoc(1), label: 'sub_001' }));
      await assertFails(batch({ ...claimDoc(1), status: 'active' }));
      await assertFails(batch({ ...claimDoc(1), created_at: new Date('2020-01-01') }));
      await assertFails(batch({ ...claimDoc(1), extra: 1 }));
      await assertSucceeds(batch(claimDoc(1)));
    });

    it('a claim can only move reserved -> active -> complete by its owner', async () => {
      await claim(anon(env, 'A'), 'A', 1);
      const doc = anon(env, 'A').doc(path('claims/1'));
      await assertFails(doc.update({ status: 'complete' }));
      await assertSucceeds(doc.update({ status: 'active' }));
      await assertSucceeds(doc.update({ status: 'complete' }));
      await assertFails(anon(env, 'B').doc(path('claims/1')).update({ status: 'void' }));
    });
  });

  describe('sessions', () => {
    beforeEach(async () => { await claim(anon(env, 'A'), 'A', 1); });

    it('6. a session whose subject_id is not the label of the uid\'s own claim: denied', async () => {
      await assertFails(anon(env, 'A').doc(sessionPath('A', 'sub-002_ses-01')).set(sessionDoc('A', { subject: 'sub-002' })));
    });

    it('7. a valid session of the uid\'s own claim: allowed', async () => {
      await assertSucceeds(anon(env, 'A').doc(sessionPath('A')).set(sessionDoc('A')));
    });

    it('8. extra key, wrong uid, or wrong document key: denied', async () => {
      const db = anon(env, 'A');
      await assertFails(db.doc(sessionPath('A')).set({ ...sessionDoc('A'), secret: 1 }));
      await assertFails(db.doc(sessionPath('A')).set(sessionDoc('B')));
      await assertFails(db.doc(sessionPath('A', 'sub-001_ses-02')).set(sessionDoc('A')));
      await assertFails(db.doc(sessionPath('A')).set({ ...sessionDoc('A'), status: 'complete' }));
      await assertFails(db.doc(sessionPath('A')).set({ ...sessionDoc('A'), experiment_id: 'other' }));
      const { consent: _consent, ...withoutConsent } = sessionDoc('A');
      await assertFails(db.doc(sessionPath('A')).set(withoutConsent));
    });

    it('9. the participant can never read their own session or chunk back', async () => {
      const db = anon(env, 'A');
      await db.doc(sessionPath('A')).set(sessionDoc('A'));
      await db.doc(`${sessionPath('A')}/chunks/0`).set(chunkDoc(0));
      await assertFails(db.doc(sessionPath('A')).get());
      await assertFails(db.doc(`${sessionPath('A')}/chunks/0`).get());
      await assertFails(db.collection(path('data/A/sessions')).get());
    });

    describe('after the session exists', () => {
      beforeEach(async () => { await anon(env, 'A').doc(sessionPath('A')).set(sessionDoc('A')); });
      const end = { status: 'complete', ended_at: '2026-10-01T10:41:10Z', end_reason: 'complete', n_chunks: 3, last_seq: 99 };

      it('10. the end-of-session update with the allowed keys: allowed', async () => {
        await assertSucceeds(anon(env, 'A').doc(sessionPath('A')).update(end));
      });

      it('11. a second update after the status left in_progress: denied', async () => {
        const doc = anon(env, 'A').doc(sessionPath('A'));
        await doc.update(end);
        await assertFails(doc.update({ last_seq: 100 }));
        await assertFails(doc.update({ status: 'aborted' }));
      });

      it('12. an update that changes subject_id (or any other key): denied', async () => {
        const doc = anon(env, 'A').doc(sessionPath('A'));
        await assertFails(doc.update({ subject_id: 'sub-002' }));
        await assertFails(doc.update({ uid: 'B' }));
        await assertFails(doc.update({ consent: { mode: 'attested', text_hash: 'x', accepted_at: 'y' } }));
        await assertFails(doc.update({ ...end, subject: { sex: 'male', age: 99 } }));
      });

      it('13. chunk 0 with a valid shape: allowed', async () => {
        await assertSucceeds(anon(env, 'A').doc(`${sessionPath('A')}/chunks/0`).set(chunkDoc(0)));
      });

      it('chunks need an existing session, a matching index and a valid shape', async () => {
        const db = anon(env, 'A');
        await assertFails(db.doc(`${sessionPath('A')}/chunks/1`).set(chunkDoc(0)));
        await assertFails(db.doc(`${sessionPath('A')}/chunks/0`).set({ ...chunkDoc(0), encoding: 'zip' }));
        await assertFails(db.doc(`${sessionPath('A')}/chunks/0`).set({ ...chunkDoc(0), n_events: 0 }));
        await assertFails(db.doc(`${sessionPath('A')}/chunks/0`).set({ ...chunkDoc(0), n_events: 5001 }));
        await assertFails(db.doc(`${sessionPath('A')}/chunks/0`).set({ ...chunkDoc(0), from_seq: 9, to_seq: 3 }));
        await assertFails(db.doc(`${sessionPath('A')}/chunks/0`).set({ ...chunkDoc(0), extra: 1 }));
        await assertFails(db.doc(`${sessionPath('A', 'sub-001_ses-02')}/chunks/0`).set(chunkDoc(0)));
      });

      it('14. a chunk with a 950,000-character payload: denied; 900,000 is the limit', async () => {
        const db = anon(env, 'A');
        await assertFails(db.doc(`${sessionPath('A')}/chunks/0`).set({ ...chunkDoc(0), payload: 'x'.repeat(950_000) }));
        await assertSucceeds(db.doc(`${sessionPath('A')}/chunks/0`).set({ ...chunkDoc(0), payload: 'x'.repeat(900_000) }));
        await assertFails(db.doc(`${sessionPath('A')}/chunks/1`).set({ ...chunkDoc(1), payload: 'x'.repeat(900_001) }));
      });

      it('15. rewriting a chunk with a different payload: denied', async () => {
        const doc = anon(env, 'A').doc(`${sessionPath('A')}/chunks/0`);
        await doc.set(chunkDoc(0));
        await assertFails(doc.set({ ...chunkDoc(0), payload: `${chunkDoc(0).payload} ` }));
      });

      it('16. rewriting a chunk with an identical payload (a retry): allowed', async () => {
        const doc = anon(env, 'A').doc(`${sessionPath('A')}/chunks/0`);
        await doc.set(chunkDoc(0));
        await assertSucceeds(doc.set(chunkDoc(0)));
      });
    });

    it('17. writing into another uid\'s data: denied', async () => {
      await claim(anon(env, 'B'), 'B', 2);
      await assertFails(anon(env, 'B').doc(sessionPath('A')).set(sessionDoc('A')));
      await anon(env, 'A').doc(sessionPath('A')).set(sessionDoc('A'));
      await assertFails(anon(env, 'B').doc(`${sessionPath('A')}/chunks/0`).set(chunkDoc(0)));
      await assertFails(anon(env, 'B').doc(sessionPath('A')).update({ status: 'complete', ended_at: 'x', end_reason: 'complete', n_chunks: 0, last_seq: 0 }));
    });
  });

  describe('admins and others', () => {
    beforeEach(async () => {
      await claim(anon(env, 'A'), 'A', 1);
      await anon(env, 'A').doc(sessionPath('A')).set(sessionDoc('A'));
      await anon(env, 'A').doc(`${sessionPath('A')}/chunks/0`).set(chunkDoc(0));
    });

    it('18. an admin lists claims, reads data, and runs a collection-group query: allowed', async () => {
      const db = admin(env);
      await assertSucceeds(db.collection(path('claims')).get());
      await assertSucceeds(db.doc(sessionPath('A')).get());
      await assertSucceeds(db.doc(`${sessionPath('A')}/chunks/0`).get());
      await assertSucceeds(db.collectionGroup('sessions').where('experiment_id', '==', EXP).get());
    });

    it('19. a signed-in non-admin cannot run a collection-group read', async () => {
      await assertFails(anon(env, 'C').collectionGroup('sessions').where('experiment_id', '==', EXP).get());
      await assertFails(env.authenticatedContext('C', { email: 'other@x.example', email_verified: true }).firestore().collectionGroup('sessions').where('experiment_id', '==', EXP).get());
      await assertFails(env.unauthenticatedContext().firestore().collectionGroup('sessions').where('experiment_id', '==', EXP).get());
    });

    it('anonymous users cannot list claims or read the marker of another uid', async () => {
      await assertFails(anon(env, 'B').collection(path('claims')).get());
      await assertFails(anon(env, 'B').doc(path('claims_by_uid/A')).get());
      await assertSucceeds(anon(env, 'A').doc(path('claims_by_uid/A')).get());
      await assertSucceeds(anon(env, 'B').doc(path('claims/1')).get()); // existence probing for the allocator
    });

    it('nobody can write above the experiment level, and the allow-list is read-only', async () => {
      await assertFails(admin(env).doc(`experiments/${EXP}`).set({ x: 1 }));
      await assertFails(admin(env).doc(path('admins/new@lab.example')).set({ x: 1 }));
    });

    it('unauthenticated clients can do nothing', async () => {
      const db = env.unauthenticatedContext().firestore();
      await assertFails(db.doc(path('claims/9')).get());
      await assertFails(db.doc(path('claims/9')).set(claimDoc(9)));
    });
  });

  it('23. a user listed as admin whose email is not verified: denied', async () => {
    await claim(anon(env, 'A'), 'A', 1);
    await anon(env, 'A').doc(sessionPath('A')).set(sessionDoc('A'));
    await addAdmin(env, 'unverified@lab.example');
    const db = env.authenticatedContext('U', { email: 'unverified@lab.example', email_verified: false }).firestore();
    await assertFails(db.collection(path('claims')).get());
    await assertFails(db.doc(sessionPath('A')).get());
    await assertFails(db.collectionGroup('sessions').where('experiment_id', '==', EXP).get());
    const verified = env.authenticatedContext('V', { email: 'unverified@lab.example', email_verified: true }).firestore();
    await assertSucceeds(verified.collection(path('claims')).get());
  });
});

describe('controlled mode', () => {
  let env;
  beforeAll(async () => { env = await environment('controlled'); });
  beforeEach(async () => { await env.clearFirestore(); await addAdmin(env); });

  it('20. an admin creates claim 5 as an override (any free number): allowed', async () => {
    await assertSucceeds(admin(env).doc(path('claims/5')).set(claimDoc(5)));
  });

  it('21. an admin creates claim 5 again: denied', async () => {
    await admin(env).doc(path('claims/5')).set(claimDoc(5));
    await assertFails(admin(env).doc(path('claims/5')).set(claimDoc(5)));
  });

  it('21b. rewriting an existing claim without changing its status is denied (two "creates" in the same millisecond)', async () => {
    await admin(env).doc(path('claims/5')).set(claimDoc(5));
    await assertFails(admin(env).doc(path('claims/5')).update({ status: 'reserved' }));
    await assertSucceeds(admin(env).doc(path('claims/5')).update({ status: 'active' }));
  });

  it('22. an anonymous user can write nothing', async () => {
    const db = anon(env, 'A');
    await assertFails(db.doc(path('claims/1')).set(claimDoc(1)));
    await assertFails(db.doc(sessionPath('A')).set(sessionDoc('A')));
    await assertFails(db.doc(path('claims_by_uid/A')).set(markerDoc(1)));
  });

  it('an admin writes their own session and chunks, and finishes it once', async () => {
    const db = admin(env, 'admin-uid');
    await assertSucceeds(db.doc(sessionPath('admin-uid')).set(sessionDoc('admin-uid')));
    await assertSucceeds(db.doc(`${sessionPath('admin-uid')}/chunks/0`).set(chunkDoc(0)));
    await assertFails(db.doc(sessionPath('someone-else')).set(sessionDoc('someone-else')));
    const end = { status: 'complete', ended_at: '2026-10-01T10:41:10Z', end_reason: 'complete', n_chunks: 1, last_seq: 4 };
    await assertSucceeds(db.doc(sessionPath('admin-uid')).update(end));
    await assertFails(db.doc(sessionPath('admin-uid')).update({ last_seq: 5 }));
  });

  it('23. an unverified admin is denied here too', async () => {
    await addAdmin(env, 'unverified@lab.example');
    const db = env.authenticatedContext('U', { email: 'unverified@lab.example', email_verified: false }).firestore();
    await assertFails(db.doc(path('claims/1')).set(claimDoc(1)));
    await assertFails(db.collection(path('claims')).get());
  });

  it('claims are never readable by participants in any form', async () => {
    await admin(env).doc(path('claims/1')).set(claimDoc(1));
    await assertFails(anon(env, 'A').doc(path('claims/1')).get());
    await assertSucceeds(admin(env).collection(path('claims')).get());
    expect((await admin(env).collection(path('claims')).get()).size).toBe(1);
  });
});
