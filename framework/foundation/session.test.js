import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sessionProblems } from '../../tools/validators.js';
import {
  createConsentGate, createSessionRecord, finishSessionRecord, formatLabel, hashText, normalizeSessionId, normalizeSubjectId,
  parseUrlParams, resolveSeed,
} from './session.js';

const sample = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'spec', 'examples', 'session.sample.json'), 'utf8'));
const recordFields = () => ({
  subjectId: sample.subject_id,
  sessionId: sample.session_id,
  startedAt: sample.started_at,
  experiment: sample.experiment,
  consent: sample.consent,
  device: sample.device,
  clock: sample.clock,
  stage: sample.stage,
  subject: sample.subject,
  session_fields: sample.session_fields,
  url_params: sample.url_params,
  sinks: sample.sinks,
  eyetracking: sample.eyetracking,
  overlays: sample.overlays,
});

describe('ids', () => {
  it.each([
    ['007', 'sub-007'], ['sub-007', 'sub-007'], [' 12 ', 'sub-12'], ['AB9', 'sub-AB9'], [7, 'sub-7'],
    ['sub_007', null], ['sub-', null], ['', null], ['a b', null], ['sub-a-b', null], [undefined, null],
  ])('subject %j -> %j', (raw, expected) => {
    expect(normalizeSubjectId(raw)).toBe(expected);
  });

  it.each([['01', 'ses-01'], ['ses-01', 'ses-01'], ['ses_1', null], ['sub-01', null]])('session %j -> %j', (raw, expected) => {
    expect(normalizeSessionId(raw)).toBe(expected);
  });

  it('formats padded labels', () => {
    expect(formatLabel('sub', 7, 3)).toBe('sub-007');
    expect(formatLabel('sub', 1234, 3)).toBe('sub-1234');
    expect(formatLabel('ses', 1, 2)).toBe('ses-01');
  });

  it('produces ids that the session schema accepts', () => {
    const record = createSessionRecord({ ...recordFields(), subjectId: normalizeSubjectId('7'), sessionId: normalizeSessionId('1') });
    expect(sessionProblems(record)).toEqual([]);
  });
});

describe('parseUrlParams', () => {
  it('copies only the named parameters that are present', () => {
    expect(parseUrlParams('?PROLIFIC_PID=abc123&other=1&STUDY_ID=s9', ['PROLIFIC_PID', 'STUDY_ID', 'SESSION_ID']))
      .toEqual({ PROLIFIC_PID: 'abc123', STUDY_ID: 's9' });
  });

  it('decodes values, keeps empty ones, and copies nothing by default', () => {
    expect(parseUrlParams('?a=x%20y&b=', ['a', 'b'])).toEqual({ a: 'x y', b: '' });
    expect(parseUrlParams('?a=1')).toEqual({});
  });
});

describe('resolveSeed', () => {
  const fakeCrypto = { getRandomValues: (array) => { array[0] = 4_000_000_001; return array; } };

  it('keeps an integer seed and draws one for auto / undefined', () => {
    expect(resolveSeed(12345)).toBe(12345);
    expect(resolveSeed(0)).toBe(0);
    expect(resolveSeed('auto', fakeCrypto)).toBe(4_000_000_001);
    expect(resolveSeed(undefined, fakeCrypto)).toBe(4_000_000_001);
  });

  it('draws different seeds from the platform generator', () => {
    expect(resolveSeed('auto')).not.toBe(resolveSeed('auto'));
  });

  it('rejects other values', () => {
    expect(() => resolveSeed('lucky')).toThrow(TypeError);
    expect(() => resolveSeed(1.5)).toThrow(TypeError);
  });
});

describe('hashText', () => {
  it('is the SHA-256 of the UTF-8 text', async () => {
    expect(await hashText('abc')).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hashText('')).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('consent gate', () => {
  const statements = [{ id: 'read' }, { id: 'voluntary' }, { id: 'photos', required: false }];

  it('starts pending and needs every required statement', () => {
    const gate = createConsentGate({ statements });
    expect(gate.state).toBe('pending');
    expect(gate.accept({ read: true })).toEqual({ ok: false, reason: 'statement_required', ids: ['voluntary'] });
    expect(gate.accept({ read: true, voluntary: false })).toMatchObject({ ok: false, ids: ['voluntary'] });
    expect(gate.accepted).toBe(false);
    expect(gate.accept({ read: true, voluntary: true })).toEqual({ ok: true });
    expect(gate.accepted).toBe(true);
  });

  it('records every statement with its answer, optional ones included', () => {
    const gate = createConsentGate({ mode: 'attested', statements });
    gate.accept({ read: true, voluntary: true });
    expect(gate.record({ textHash: 'sha256:aa', acceptedAt: '2026-10-01T10:00:00Z' })).toEqual({
      mode: 'attested',
      text_hash: 'sha256:aa',
      accepted_at: '2026-10-01T10:00:00Z',
      statements: [{ id: 'read', accepted: true }, { id: 'voluntary', accepted: true }, { id: 'photos', accepted: false }],
    });
  });

  it('refuses to produce a record before acceptance, and after a decline', () => {
    const gate = createConsentGate({ statements });
    expect(() => gate.record({ textHash: 'x', acceptedAt: 'y' })).toThrow(/not been accepted/);
    gate.decline();
    expect(gate.state).toBe('declined');
    expect(gate.accept({ read: true, voluntary: true })).toEqual({ ok: false, reason: 'declined' });
    expect(() => gate.record({ textHash: 'x', acceptedAt: 'y' })).toThrow();
  });

  it('accepts with no statements', () => {
    const gate = createConsentGate({});
    expect(gate.accept()).toEqual({ ok: true });
    expect(gate.record({ textHash: 'h', acceptedAt: 't' })).toEqual({ mode: 'on_screen', text_hash: 'h', accepted_at: 't' });
  });

  it.each([
    [18, 24, true], [18, 18, true], [18, 17, false], [18, 'n/a', false], [18, undefined, false], [undefined, undefined, true],
  ])('min_age %j with age %j -> eligible %s', (minAge, age, expected) => {
    expect(createConsentGate({ min_age: minAge }).checkAge(age).eligible).toBe(expected);
  });
});

describe('session record', () => {
  it('builds a record the session schema accepts, in progress and open-ended', () => {
    const record = createSessionRecord(recordFields());
    expect(record).toMatchObject({ schema_version: 1, status: 'in_progress', ended_at: null });
    expect(sessionProblems(record)).toEqual([]);
  });

  it('refuses to exist before consent', () => {
    expect(() => createSessionRecord({ ...recordFields(), consent: undefined })).toThrow(/consent/);
  });

  it('keeps optional blocks out unless given', () => {
    const record = createSessionRecord({ ...recordFields(), subject: undefined, session_fields: undefined, url_params: undefined });
    for (const key of ['subject', 'session_fields', 'url_params', 'uid', 'experiment_id']) expect(record).not.toHaveProperty(key);
  });

  it.each([
    ['complete', 'complete'], ['aborted', 'aborted'], ['error', 'error'], ['device_rejected', 'device_rejected'],
  ])('finishing with %s sets status %s and validates', (reason, status) => {
    const open = createSessionRecord(recordFields());
    const done = finishSessionRecord(open, { reason, endedAt: '2026-10-01T10:30:00Z', nChunks: 12, lastSeq: 4711 });
    expect(done).toMatchObject({ status, end_reason: reason, ended_at: '2026-10-01T10:30:00Z', n_chunks: 12, last_seq: 4711 });
    expect(open.status).toBe('in_progress');
    expect(sessionProblems(done)).toEqual([]);
  });

  it('omits chunk counters when unknown (local-only sessions) and rejects unknown reasons', () => {
    const done = finishSessionRecord(createSessionRecord(recordFields()), { reason: 'complete', endedAt: '2026-10-01T10:30:00Z' });
    expect(done).not.toHaveProperty('n_chunks');
    expect(() => finishSessionRecord(done, { reason: 'bored', endedAt: 'x' })).toThrow(TypeError);
  });

  it('reproduces the sample session when given the sample parts', () => {
    const done = finishSessionRecord(createSessionRecord(recordFields()), { reason: 'complete', endedAt: sample.ended_at });
    expect(done).toMatchObject({ ...sample, end_reason: 'complete' });
  });
});
