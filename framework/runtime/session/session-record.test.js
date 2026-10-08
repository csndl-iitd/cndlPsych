import { describe, expect, it } from 'vitest';
import { createConsentGate } from '../../foundation/session.js';
import { buildSessionRecord, sinkRecord } from './session-record.js';

const sinkSet = (configs = []) => ({ configs, record: () => configs.map((c) => ({ id: c.id, connected: true })) });

describe('sinkRecord', () => {
  it('lists the trigger sinks only when there are some, and where the data is stored', () => {
    expect(sinkRecord(sinkSet(), null)).toEqual({ storage: ['local'] });
    expect(sinkRecord(sinkSet([{ id: 'a' }]), null)).toEqual({ trigger: [{ id: 'a', connected: true }], storage: ['local'] });
    expect(sinkRecord(sinkSet(), {})).toEqual({ storage: ['local', 'firebase'] });
  });
});

describe('buildSessionRecord', () => {
  const gate = createConsentGate({ statements: [{ id: 'read', text: 'x' }] });
  gate.accept({ read: true });
  const run = (planExtra = {}, customModules = []) => ({
    remote: null,
    env: { user_agent: 'UA', platform: 'Win32', language: 'en', screen: { w: 1280, h: 720, dpr: 1 }, viewport: { w: 1280, h: 720 }, pointer: 'fine', hover: 'hover', touch_points: 0, keyboard: true },
    project: { specHash: 'sha256:abc', customModules, plan: { name: 'Study', spec_version: 1, capture_url_params: ['PROLIFIC_PID'], stage: { aspect: 'fill' }, ...planExtra } },
    services: {
      clock: { anchor: () => ({ time_origin_ms: 1000, wall_iso: '2026-10-08T10:00:00.000Z', timezone: 'UTC', utc_offset_min: 0 }) },
      stage: { rect: { x: 0, y: 0, w: 800, h: 400 } },
      sinkSet: sinkSet(),
      overlay: { record: () => ({ photodiode: { corner: 'bl', size_px: 38 } }) },
    },
  });
  const build = (r, extra = {}) => buildSessionRecord({
    run: r,
    ids: { subjectId: 'sub-007', sessionId: 'ses-01' },
    answers: { subject: { sex: 'female', age: 24 }, sessionFields: { session_type: 'Control' } },
    gate,
    consent: { textHash: 'sha256:c0ffee', acceptedAt: '2026-10-08T10:00:01Z' },
    device: { profile: 'desktop', reason: 'auto' },
    seed: 99,
    refreshHz: 59.9,
    search: '?PROLIFIC_PID=abc&other=1',
    ...extra,
  });

  it('collects what is known when recording starts', () => {
    const record = build(run());
    expect(record).toMatchObject({
      schema_version: 1, subject_id: 'sub-007', session_id: 'ses-01', status: 'in_progress', ended_at: null,
      experiment: { name: 'Study', spec_version: 1, spec_hash: 'sha256:abc', seed: 99 },
      consent: { text_hash: 'sha256:c0ffee', accepted_at: '2026-10-08T10:00:01Z', statements: [{ id: 'read', accepted: true }] },
      device: { profile: 'desktop', profile_reason: 'auto', refresh_hz_est: 59.9 },
      clock: { time_origin_ms: 1000 },
      stage: { rect: { w: 800, h: 400 }, aspect: 2, letterboxed: false },
      subject: { sex: 'female', age: 24 },
      session_fields: { session_type: 'Control' },
      url_params: { PROLIFIC_PID: 'abc' },
      sinks: { storage: ['local'] },
      overlays: { photodiode: { corner: 'bl', size_px: 38 } },
    });
  });

  it('marks a letterboxed stage, lists custom modules only when there are some, and omits the refresh rate when it was not measured', () => {
    const letterboxed = build(run({ stage: { aspect: '16:9' } }, [{ kind: 'stimulus', name: 'x', hash: 'h' }]), { refreshHz: undefined });
    expect(letterboxed.stage.letterboxed).toBe(true);
    expect(letterboxed.experiment.custom_modules).toEqual([{ kind: 'stimulus', name: 'x', hash: 'h' }]);
    expect(letterboxed.device.refresh_hz_est).toBeUndefined();
    expect(build(run()).experiment.custom_modules).toBeUndefined();
  });
});
