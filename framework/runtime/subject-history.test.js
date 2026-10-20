import { describe, expect, it } from 'vitest';
import { mergeSessions, nextSessionId, summarizeHistory } from './subject-history.js';

describe('nextSessionId', () => {
  it('is one more than the highest numbered session, padded like it', () => {
    expect(nextSessionId([])).toBe('ses-01');
    expect(nextSessionId(['ses-01'])).toBe('ses-02');
    expect(nextSessionId(['ses-01', 'ses-09', 'ses-03'])).toBe('ses-10');
    expect(nextSessionId(['ses-007'])).toBe('ses-008');
  });

  it('ignores ids that are not numbered', () => {
    expect(nextSessionId(['ses-pilot', 'ses-02'])).toBe('ses-03');
    expect(nextSessionId(['ses-pilot'])).toBe('ses-01');
  });
});

describe('summarizeHistory', () => {
  const sessions = [
    { session_id: 'ses-02', started_at: '2026-10-05T09:00:00Z', subject: { sex: 'female', age: 31 } },
    { session_id: 'ses-01', started_at: '2026-10-01T09:00:00Z', subject: { sex: 'female', age: 30, handedness: 'right' } },
    { session_id: 'ses-03', started_at: '2026-10-09T09:00:00Z' }, // an interrupted one with no answers kept
  ];

  it('takes the details from the latest session that has any, lists the sessions in time order, and suggests the next', () => {
    expect(summarizeHistory(sessions)).toEqual({
      sessions: 3,
      sessionIds: ['ses-01', 'ses-02', 'ses-03'],
      subject: { sex: 'female', age: 31 },
      from: { session_id: 'ses-02', started_at: '2026-10-05T09:00:00Z' },
      nextSession: 'ses-04',
    });
  });

  it('is empty for a participant with no sessions found', () => {
    expect(summarizeHistory([])).toEqual({ sessions: 0, sessionIds: [], subject: {}, nextSession: 'ses-01' });
  });
});

describe('mergeSessions', () => {
  it('puts lists together without the same session twice', () => {
    const a = { session_id: 'ses-01', started_at: 't1' };
    const merged = mergeSessions([a], [{ ...a }, { session_id: 'ses-02', started_at: 't2' }]);
    expect(merged.map((s) => s.session_id)).toEqual(['ses-01', 'ses-02']);
  });
});
