import { describe, expect, it } from 'vitest';
import { createMode, modeFromSearch, resolveModes, TEST_DEFAULTS } from './modes.js';

describe('resolveModes', () => {
  it('asks which mode, starting with live, and gives test mode a short run and a throwaway ID, when experiment.yaml says nothing', () => {
    const modes = resolveModes();
    expect(modes).toMatchObject({ enabled: true, default: 'live' });
    expect(modes.settings('live')).toEqual({});
    expect(modes.settings('test')).toEqual(TEST_DEFAULTS);
  });

  it('takes the numbers from experiment.yaml over the defaults, for either mode', () => {
    const modes = resolveModes({ default: 'test', test: { trials_per_block: 2, block_trials: { search: 1 } }, live: { trials_per_block: 40 } });
    expect(modes.default).toBe('test');
    expect(modes.settings('test')).toEqual({ trials_per_block: 2, subject_id: 'sub-test', block_trials: { search: 1 } });
    expect(modes.settings('live')).toEqual({ trials_per_block: 40 });
  });

  it('does not ask when switched off, nor for a public experiment', () => {
    expect(resolveModes({ enabled: false }).enabled).toBe(false);
    expect(resolveModes({}, { publicAccess: true }).enabled).toBe(false);
  });
});

describe('modeFromSearch', () => {
  it('reads ?mode=test and ?mode=live, and nothing else', () => {
    expect(modeFromSearch('?mode=test&x=1')).toBe('test');
    expect(modeFromSearch('?mode=live')).toBe('live');
    expect(modeFromSearch('?mode=other')).toBeNull();
    expect(modeFromSearch('')).toBeNull();
  });
});

describe('createMode', () => {
  it('limits the trials of a block: a number for the block wins over the one for every block, live has none by default', () => {
    const test = createMode('test', { trials_per_block: 3, block_trials: { search: 5 }, subject_id: 'sub-try' });
    expect(test).toMatchObject({ name: 'test', test: true, subjectId: 'sub-try' });
    expect(test.trialLimit('oddball')).toBe(3);
    expect(test.trialLimit('search')).toBe(5);
    const live = createMode('live', {});
    expect(live).toMatchObject({ name: 'live', test: false });
    expect(live.trialLimit('oddball')).toBeNull();
    expect(live).not.toHaveProperty('subjectId');
  });
});
