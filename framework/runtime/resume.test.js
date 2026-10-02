import { describe, expect, it } from 'vitest';
import { sessionProblems } from '../../tools/validators.js';
import { checkResumable, findResumePoint, resumedRecord } from './resume.js';

const plan = {
  device: { allowed: ['desktop', 'phone'] },
  blocks: [
    { id: 'intro', module: 'instructions', repeat: 1 },
    { id: 'task', module: 'response_task', repeat: 2 },
    { id: 'survey', module: 'survey', repeat: 1 },
  ],
};

let seq;
const ev = (type, data = {}, block = null) => ({ v: 1, seq: seq++, t: seq, source: 'system', type, data, block, trial: null, phase: null, caused_by: null });
const start = (id) => ev('block.start', { block_id: id, module: 'x', n_trials: 3 }, id);
const end = (id, reason = 'complete') => ev('block.end', { block_id: id, reason }, id);
const trialEnd = (id) => ev('trial.end', { trial: 1, outcome: 'completed' }, id);
const log = (...makers) => { seq = 0; return [ev('session.start'), ...makers.map((make) => make())]; };

describe('findResumePoint', () => {
  it('starts at the first block when nothing ran yet', () => {
    expect(findResumePoint(plan, log())).toEqual({ blockIndex: 0, run: 1, completedTrials: 0, started: false });
  });

  it('restarts a non-trial block that was started but not finished', () => {
    expect(findResumePoint(plan, log(() => start('intro')))).toEqual({ blockIndex: 0, run: 1, completedTrials: 0, started: true });
  });

  it('skips finished blocks and counts the finished trials of the interrupted one', () => {
    const events = log(() => start('intro'), () => end('intro'), () => start('task'), () => trialEnd('task'), () => trialEnd('task'));
    expect(findResumePoint(plan, events)).toEqual({ blockIndex: 1, run: 1, completedTrials: 2, started: true });
  });

  it('knows a block was finished but the next one never started', () => {
    expect(findResumePoint(plan, log(() => start('intro'), () => end('intro')))).toEqual({ blockIndex: 1, run: 1, completedTrials: 0, started: false });
  });

  it('handles repeated blocks: the second run counts only its own trials', () => {
    const events = log(
      () => start('intro'), () => end('intro'),
      () => start('task'), () => trialEnd('task'), () => trialEnd('task'), () => trialEnd('task'), () => end('task'),
      () => start('task'), () => trialEnd('task'),
    );
    expect(findResumePoint(plan, events)).toEqual({ blockIndex: 1, run: 2, completedTrials: 1, started: true });
  });

  it('a repeated block whose second run has not started', () => {
    const events = log(() => start('intro'), () => end('intro'), () => start('task'), () => end('task'));
    expect(findResumePoint(plan, events)).toEqual({ blockIndex: 1, run: 2, completedTrials: 0, started: false });
  });

  it('does not run again a block that was skipped', () => {
    const events = log(() => start('intro'), () => end('intro'), () => end('task', 'skipped'));
    expect(findResumePoint(plan, events)).toEqual({ blockIndex: 2, run: 1, completedTrials: 0, started: false });
  });

  it('when every block is done only the end of the session is left', () => {
    const events = log(
      () => start('intro'), () => end('intro'), () => start('task'), () => end('task'), () => start('task'), () => end('task'),
      () => start('survey'), () => end('survey'),
    );
    expect(findResumePoint(plan, events)).toEqual({ blockIndex: 3, run: 1, completedTrials: 0, started: false });
  });

  it('ignores trial.end events of other blocks', () => {
    const events = log(() => start('intro'), () => trialEnd('other'), () => end('intro'), () => start('task'), () => trialEnd('intro'));
    expect(findResumePoint(plan, events).completedTrials).toBe(0);
  });
});

describe('checkResumable', () => {
  const desktopEnv = { pointer: 'fine', hover: 'hover', keyboard: true, touch: false, short_side_px: 900, orientation: 'landscape' };
  const phoneEnv = { pointer: 'coarse', hover: 'none', keyboard: false, touch: true, short_side_px: 400, orientation: 'portrait' };
  const record = (changes = {}) => ({ status: 'aborted', experiment: { spec_hash: 'sha256:aa' }, device: { profile: 'desktop' }, ...changes });
  const input = (overrides = {}) => ({ record: record(), events: log(() => start('intro')), plan, specHash: 'sha256:aa', env: desktopEnv, ...overrides });

  it('accepts an interrupted, aborted or error session on the same experiment and device kind', () => {
    for (const status of ['in_progress', 'aborted', 'error']) {
      const verdict = checkResumable(input({ record: record({ status }) }));
      expect(verdict.ok).toBe(true);
      expect(verdict.point).toEqual({ blockIndex: 0, run: 1, completedTrials: 0, started: true });
    }
  });

  it.each(['complete', 'device_rejected'])('refuses a session that ended on its own (%s)', (status) => {
    expect(checkResumable(input({ record: record({ status }) }))).toMatchObject({ ok: false, reason: expect.stringContaining('ended normally') });
  });

  it('refuses when the experiment files changed', () => {
    expect(checkResumable(input({ specHash: 'sha256:bb' }))).toMatchObject({ ok: false, reason: expect.stringContaining('changed') });
  });

  it('refuses on another kind of device, naming the one it needs', () => {
    expect(checkResumable(input({ env: phoneEnv }))).toMatchObject({ ok: false, reason: expect.stringContaining('desktop') });
    expect(checkResumable(input({ record: record({ device: { profile: 'phone' } }), env: phoneEnv })).ok).toBe(true);
  });

  it('accepts when the profile is one of the candidates, or a debug override names it', () => {
    expect(checkResumable(input({ env: desktopEnv, override: 'desktop' })).ok).toBe(true);
    expect(checkResumable(input({ record: record({ device: { profile: 'phone' } }), env: desktopEnv, override: 'phone' })).ok).toBe(true);
  });

  it('refuses an incomplete or gapped log', () => {
    expect(checkResumable(input({ events: [] })).ok).toBe(false);
    const gapped = log(() => start('intro'), () => end('intro'));
    gapped.splice(1, 1);
    expect(checkResumable(input({ events: gapped }))).toMatchObject({ ok: false, reason: expect.stringContaining('incomplete') });
    expect(checkResumable(input({ events: [ev('page.focus')] })).ok).toBe(false);
  });
});

describe('resumedRecord', () => {
  const base = {
    schema_version: 1, subject_id: 'sub-007', session_id: 'ses-01', status: 'aborted', started_at: '2026-10-01T10:00:00Z',
    ended_at: '2026-10-01T10:05:00Z', end_reason: 'aborted', last_seq: 120, n_chunks: 3,
  };
  const anchor = { time_origin_ms: 1_790_000_000_000, wall_iso: '2026-10-01T11:00:00.000Z' };
  const point = { blockIndex: 1, run: 1, completedTrials: 4, started: true };

  it('reopens the record and adds a resume entry; end fields are dropped', () => {
    const record = resumedRecord(base, { lastSeq: 120, anchor, resumedAt: '2026-10-01T11:00:01Z', point, plan, frameworkVersion: '0.1.0' });
    expect(record).toMatchObject({ status: 'in_progress', ended_at: null, subject_id: 'sub-007' });
    for (const key of ['end_reason', 'last_seq', 'n_chunks']) expect(record).not.toHaveProperty(key);
    expect(record.resumes).toEqual([{ at_seq: 120, resumed_at: '2026-10-01T11:00:01Z', time_origin_ms: anchor.time_origin_ms, wall_iso: anchor.wall_iso, block_id: 'task', trial: 5, framework_version: '0.1.0' }]);
  });

  it('appends to earlier resumes, and has no trial for a block without trials', () => {
    const once = resumedRecord(base, { lastSeq: 10, anchor, resumedAt: 'a', point: { ...point, blockIndex: 0 }, plan, frameworkVersion: '0.1.0' });
    const twice = resumedRecord(once, { lastSeq: 30, anchor, resumedAt: 'b', point: { blockIndex: 3, run: 1, completedTrials: 0, started: false }, plan, frameworkVersion: '0.1.0' });
    expect(twice.resumes.map((r) => [r.at_seq, r.block_id, r.trial])).toEqual([[10, 'intro', null], [30, null, null]]);
  });

  it('can carry an updated sinks block, and validates against the session schema', () => {
    const full = {
      schema_version: 1, subject_id: 'sub-007', session_id: 'ses-01', status: 'aborted', started_at: '2026-10-01T10:00:00Z', ended_at: '2026-10-01T10:05:00Z', end_reason: 'aborted', last_seq: 5,
      experiment: { name: 'x', spec_version: 1, spec_hash: 'sha256:aa', framework_version: '0.1.0', seed: 1 },
      consent: { mode: 'on_screen', text_hash: 'sha256:bb', accepted_at: '2026-10-01T10:00:00Z' },
      device: { profile: 'desktop', profile_reason: 'auto', user_agent: 'x', screen: { w: 1, h: 1, dpr: 1 }, viewport: { w: 1, h: 1 } },
      clock: { time_origin_ms: 1, wall_iso: '2026-10-01T10:00:00.000Z', timezone: 'UTC' },
      stage: { rect: { x: 0, y: 0, w: 1, h: 1 }, aspect: 1 },
    };
    const record = resumedRecord(full, { lastSeq: 5, anchor, resumedAt: '2026-10-01T11:00:01Z', point, plan, frameworkVersion: '0.1.0', sinks: { storage: ['local'] } });
    expect(record.sinks).toEqual({ storage: ['local'] });
    expect(sessionProblems(record)).toEqual([]);
  });
});
