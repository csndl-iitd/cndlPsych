import { describe, expect, it } from 'vitest';
import { acceptedIntents, correctRule, trialOutcome } from './outcome.js';

describe('acceptedIntents', () => {
  it.each([
    [undefined, []], ['none', []], ['go', ['go']], [['a', 'b'], ['a', 'b']], ['any', ['any']], [['none'], []],
  ])('%j -> %j', (response, expected) => {
    expect(acceptedIntents(response)).toEqual(expected);
  });
});

describe('correctRule', () => {
  it.each([
    [undefined, null],
    ['go', { intents: ['go'] }],
    [['a', 'b'], { intents: ['a', 'b'] }],
    [{ intent: 'go', where: { stimulus: 's' } }, { intents: ['go'], where: { stimulus: 's' } }],
    [{ intent: ['a', 'b'] }, { intents: ['a', 'b'], where: undefined }],
  ])('%j', (correct, expected) => {
    expect(correctRule(correct)).toEqual(expected);
  });
});

describe('trialOutcome', () => {
  const r = (correct) => ({ correct, rt: 100 });
  it.each([
    ['timeout wins', { hasRule: true, responses: [r(true)], timedOut: true }, 'timeout'],
    ['no rule, no response', { hasRule: false, responses: [], timedOut: false }, 'none'],
    ['no rule, responded', { hasRule: false, responses: [r(null)], timedOut: false }, 'completed'],
    ['rule, correct response', { hasRule: true, responses: [r(true)], timedOut: false }, 'correct'],
    ['rule, wrong response', { hasRule: true, responses: [r(false)], timedOut: false }, 'incorrect'],
    ['rule, a miss', { hasRule: true, responses: [{ correct: false, rt: null }], timedOut: false }, 'incorrect'],
    ['rule, right then wrong', { hasRule: true, responses: [r(true), r(false)], timedOut: false }, 'incorrect'],
    ['rule, nothing happened', { hasRule: true, responses: [], timedOut: false }, 'none'],
  ])('%s', (_label, input, expected) => {
    expect(trialOutcome(input)).toBe(expected);
  });
});
