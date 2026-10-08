import { describe, expect, it } from 'vitest';
import { blockApplies } from './plan.js';

const answers = { subject: { sex: 'female', age: 30 }, session: { session_type: 'Experimental' }, device: { profile: 'phone' } };

describe('blockApplies', () => {
  it.each([
    ['a block for this profile with no condition', { profiles: ['phone', 'tablet'] }, 'phone', true],
    ['a block for other profiles', { profiles: ['desktop'] }, 'phone', false],
    ['a condition that holds', { profiles: ['phone'], when: { 'session.session_type': 'Experimental' } }, 'phone', true],
    ['a condition that does not hold', { profiles: ['phone'], when: { 'session.session_type': 'Control' } }, 'phone', false],
    ['a condition on an answer about the participant', { profiles: ['phone'], when: { 'subject.age': { gte: 18 } } }, 'phone', true],
    ['a matching condition on the wrong profile', { profiles: ['desktop'], when: { 'subject.sex': 'female' } }, 'phone', false],
  ])('%s', (_label, block, profile, expected) => {
    expect(blockApplies(block, profile, answers)).toBe(expected);
  });
});
