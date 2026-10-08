import { describe, expect, it } from 'vitest';
import { completeSession, createFinisher, eyeExtras, stopSession } from './finish.js';

const record = { schema_version: 1, subject_id: 'sub-001', session_id: 'ses-01', status: 'in_progress', started_at: '2026-10-08T10:00:00Z', ended_at: null };

function fakes({ exportFormats = [], finish = {} } = {}) {
  const emitted = [];
  const calls = [];
  const display = { innerHTML: '', ownerDocument: {} };
  const services = {
    bus: { emit: (event) => emitted.push(event), lastSeq: 41 },
    display,
    sinkSet: { drain: async () => calls.push('drain'), closeAll: async () => calls.push('closeAll') },
  };
  const eye = { stop: async () => calls.push('eye.stop') };
  const project = { plan: { storage: { local: { export_on_finish: exportFormats } }, finish } };
  const finished = [];
  const finishFn = async (reason) => { calls.push(`finish:${reason}`); finished.push(reason); return { ...record, status: reason, subject_id: 'sub-001', session_id: 'ses-01' }; };
  return { services, eye, project, emitted, calls, display, finishFn };
}

describe('createFinisher', () => {
  it('closes the record with the reason, the last seq and the extras, and hands it to the store', async () => {
    const stored = [];
    const finisher = createFinisher({ record, store: { finish: async (done) => stored.push(done) }, bus: { lastSeq: 41 }, extras: () => ({ eyetracking: { enabled: false } }) });
    const done = await finisher('complete');
    expect(done).toMatchObject({ status: 'complete', end_reason: 'complete', last_seq: 41, eyetracking: { enabled: false }, subject_id: 'sub-001' });
    expect(done.ended_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stored).toEqual([done]);
  });

  it('refuses an unknown reason', async () => {
    const finisher = createFinisher({ record, store: { finish: async () => {} }, bus: { lastSeq: 0 } });
    await expect(finisher('bored')).rejects.toThrow('unknown end reason');
  });
});

describe('completeSession', () => {
  it('sends queued triggers first, then writes session.end, stops the camera, closes the record and the sinks, and thanks the participant', async () => {
    const f = fakes({ finish: { message: 'Done!', show_session_code: true } });
    const result = await completeSession({ services: f.services, project: f.project, store: {}, finish: f.finishFn, eye: f.eye });
    expect(f.calls).toEqual(['drain', 'eye.stop', 'finish:complete', 'closeAll']);
    expect(f.emitted).toEqual([{ source: 'system', type: 'session.end', data: { reason: 'complete' } }]);
    expect(result).toMatchObject({ status: 'complete', record: { status: 'complete' } });
    expect(f.display.innerHTML).toContain('Done!');
    expect(f.display.innerHTML).toContain('sub-001_ses-01');
  });

  it('warns about an export format it cannot write, before session.end', async () => {
    const f = fakes({ exportFormats: ['parquet'] });
    await completeSession({ services: f.services, project: f.project, store: {}, finish: f.finishFn, eye: f.eye });
    expect(f.emitted.map((e) => [e.type, e.data.code ?? e.data.reason])).toEqual([['system.warning', 'export_format_unsupported'], ['session.end', 'complete']]);
  });
});

describe('stopSession', () => {
  it('an exception is logged as a fatal error, ends the session as error, and says the session can be resumed', async () => {
    const f = fakes();
    const error = new Error('boom');
    const result = await stopSession({ services: f.services, finish: f.finishFn, eye: f.eye, error });
    expect(f.emitted.map((e) => e.type)).toEqual(['system.error', 'session.end']);
    expect(f.emitted[0].data).toMatchObject({ code: 'exception', message: 'boom', fatal: true });
    expect(f.emitted[1].data.reason).toBe('error');
    expect(f.calls).toEqual(['eye.stop', 'finish:error', 'closeAll']);
    expect(result).toMatchObject({ status: 'error', error });
    expect(f.display.innerHTML).toContain('?manage=1');
  });

  it('a deliberate abort is not logged as an error', async () => {
    const f = fakes();
    const error = Object.assign(new Error('eye tracking could not be validated'), { endReason: 'aborted' });
    const result = await stopSession({ services: f.services, finish: f.finishFn, eye: f.eye, error });
    expect(f.emitted.map((e) => e.type)).toEqual(['session.end']);
    expect(result.status).toBe('aborted');
    expect(f.display.innerHTML).toContain('eye tracking');
  });
});

describe('eyeExtras', () => {
  it('adds the eye tracking summary when there is one, and nothing otherwise', () => {
    expect(eyeExtras({ eye: null })()).toEqual({});
    expect(eyeExtras({ eye: { summary: () => undefined } })()).toEqual({});
    expect(eyeExtras({ eye: { summary: () => ({ enabled: false }) } })()).toEqual({ eyetracking: { enabled: false } });
  });
});
