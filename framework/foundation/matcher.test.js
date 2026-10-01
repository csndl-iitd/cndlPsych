import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import {
  compileCondition, compilePredicate, compileStep, createPatternMatcher, eventSubject, getPath, globToRegExp, matchesPredicate,
} from './matcher.js';

const EXAMPLES = join(import.meta.dirname, '..', '..', 'spec', 'examples');
const timeline = load(readFileSync(join(EXAMPLES, 'timeline.yaml'), 'utf8'));
const experiment = load(readFileSync(join(EXAMPLES, 'experiment.yaml'), 'utf8'));
const searchBlock = timeline.blocks.find((block) => block.id === 'visual_search');
const exampleRule = (id) => Object.values(searchBlock.input.profiles).flatMap((p) => p.rules ?? []).find((rule) => rule.id === id);

let clockMs = 0;
function ev(type, data = {}, t = clockMs, extra = {}) {
  clockMs = t;
  return { type, data, t, block: null, trial: null, phase: null, ...extra };
}
const tap = (id, role, t) => ev('input.tap', { target: id === null ? null : { id, role } }, t);
const key = (k, t) => ev('input.key.down', { key: k }, t);

/** Feed events; return the indexes at which the pattern completed. */
function completions(pattern, events, options) {
  const matcher = createPatternMatcher(pattern, options);
  return events.flatMap((event, i) => (matcher.feed(event) ? [i] : []));
}

describe('getPath', () => {
  it.each([
    [{ a: { b: 1 } }, 'a.b', 1],
    [{ a: { b: 1 } }, 'a', { b: 1 }],
    [{ a: null }, 'a.b', undefined],
    [{ a: 1 }, 'a.b', undefined],
    [{}, 'x.y.z', undefined],
    [{ 'a': { b: false } }, 'a.b', false],
  ])('%j at %s', (subject, path, expected) => {
    expect(getPath(subject, path)).toEqual(expected);
  });
});

describe('globToRegExp', () => {
  it.each([
    ['oddball_*', 'oddball_A', true],
    ['oddball_*', 'xoddball_A', false],
    ['*_end', 'trial_end', true],
    ['a*c', 'abbbc', true],
    ['a*c', 'abbbcd', false],
    ['a.b*', 'a.bc', true],
    ['a.b*', 'aXbc', false],
    ['a+b*', 'a+bz', true],
    ['a+b*', 'aab', false],
    ['*', '', true],
    ['(x)*', '(x)y', true],
  ])('%s vs %s -> %s', (glob, text, expected) => {
    expect(globToRegExp(glob).test(text)).toBe(expected);
  });
});

describe('conditions', () => {
  const table = [
    // scalars: strict equality
    ['a', 'a', true], ['a', 'b', false], [1, 1, true], [1, '1', false], [true, true, true], [true, 1, false], [0, false, false],
    ['a', undefined, false],
    // globs inside string scalars
    ['oddball_*', 'oddball_A', true], ['oddball_*', 'other', false], ['oddball_*', 5, false],
    // null: null or missing
    [null, null, true], [null, undefined, true], [null, 0, false], [null, '', false],
    // lists: membership (globs allowed)
    [['a', 'b'], 'b', true], [['a', 'b'], 'c', false], [[1, 2], 2, true], [['x_*', 'y'], 'x_9', true], [['a'], undefined, false],
    // operators
    [{ eq: 'a' }, 'a', true], [{ eq: 'a' }, 'b', false],
    [{ ne: 'a' }, 'b', true], [{ ne: 'a' }, 'a', false], [{ ne: 'a' }, undefined, true],
    [{ in: [1, 2] }, 2, true], [{ in: [1, 2] }, 3, false], [{ in: [] }, 1, false],
    [{ not_in: [1, 2] }, 3, true], [{ not_in: [1, 2] }, 1, false], [{ not_in: [1, 2] }, undefined, true],
    [{ gt: 5 }, 6, true], [{ gt: 5 }, 5, false], [{ gte: 5 }, 5, true], [{ lt: 5 }, 4, true], [{ lt: 5 }, 5, false], [{ lte: 5 }, 5, true],
    [{ gt: 5 }, '9', false], [{ gt: 5 }, undefined, false], [{ gt: 5 }, null, false],
    [{ glob: 'ab*' }, 'abc', true], [{ glob: 'ab*' }, 'xab', false], [{ glob: 'ab*' }, 1, false],
    [{ regex: '^a.c$' }, 'abc', true], [{ regex: '^a.c$' }, 'abcd', false], [{ regex: 'b' }, 'abc', true], [{ regex: 'b' }, 7, false],
    [{ exists: true }, 0, true], [{ exists: true }, null, true], [{ exists: true }, undefined, false],
    [{ exists: false }, undefined, true], [{ exists: false }, 0, false],
    [{ gte: 1, lt: 5 }, 3, true], [{ gte: 1, lt: 5 }, 5, false], [{ gte: 1, lt: 5 }, 0, false],
    [{ in: ['a', 'b'], ne: 'a' }, 'b', true], [{ in: ['a', 'b'], ne: 'a' }, 'a', false],
  ];
  it.each(table)('%j vs %j -> %s', (condition, value, expected) => {
    expect(compileCondition(condition)(value)).toBe(expected);
  });

  it('rejects an unknown operator when compiling, not when matching', () => {
    expect(() => compileCondition({ near: 3 })).toThrow(/unknown condition operator "near"/);
  });
});

describe('predicates', () => {
  const subject = { stimulus: 'oddball_A', correct: true, rt_ms: 420, target: { id: 3, role: 'target' }, trial: 4 };
  const table = [
    [{}, true],
    [{ stimulus: 'oddball_A' }, true],
    [{ stimulus: 'oddball_*' }, true],
    [{ stimulus: 'other' }, false],
    [{ correct: true, trial: 4 }, true],
    [{ correct: true, trial: 5 }, false],
    [{ 'target.role': 'target' }, true],
    [{ 'target.id': { gt: 2 } }, true],
    [{ 'target.nope': { exists: false } }, true],
    [{ rt_ms: { gte: 100, lte: 500 } }, true],
    [{ all: [{ correct: true }, { trial: 4 }] }, true],
    [{ all: [{ correct: true }, { trial: 5 }] }, false],
    [{ any: [{ trial: 5 }, { correct: true }] }, true],
    [{ any: [{ trial: 5 }, { correct: false }] }, false],
    [{ not: { correct: false } }, true],
    [{ not: { correct: true } }, false],
    [{ stimulus: 'oddball_A', not: { trial: 9 } }, true],
    [{ stimulus: 'oddball_A', any: [{ trial: 9 }, { trial: 4 }], not: { correct: false } }, true],
    [{ any: [{ all: [{ trial: 4 }, { correct: false }] }, { not: { stimulus: 'x' } }] }, true],
    [{ not: { any: [{ trial: 4 }, { trial: 5 }] } }, false],
  ];
  it.each(table)('%j -> %s', (predicate, expected) => {
    expect(matchesPredicate(predicate, subject)).toBe(expected);
  });

  it('matches an empty subject only for predicates that allow missing fields', () => {
    expect(compilePredicate({ a: 1 })({})).toBe(false);
    expect(compilePredicate({ a: { exists: false } })({})).toBe(true);
    expect(compilePredicate({ a: null })({})).toBe(true);
  });

  it('is evaluated against event data plus block / trial / phase', () => {
    const event = { type: 'response.evaluated', data: { correct: true, phase: 'search', stimulus: 's' }, block: 'b', trial: 2, phase: 'other' };
    expect(eventSubject(event)).toEqual({ correct: true, phase: 'search', stimulus: 's', block: 'b', trial: 2 });
  });
});

describe('predicates and steps from spec/examples', () => {
  const rules = experiment.triggers.rules;
  const evaluated = (correct) => ev('response.evaluated', { intent: 'go', correct, rt_ms: 300 });

  it.each([
    ['resp_correct', evaluated(true), true],
    ['resp_correct', evaluated(false), false],
    ['resp_incorrect', evaluated(false), true],
    ['resp_incorrect', evaluated(null), false],
    ['resp_timeout', ev('response.timeout', { phase: 'p', timeout_ms: 10000 }), true],
    ['resp_timeout', evaluated(true), false],
  ])('trigger rule %s on %j -> %s', (id, event, expected) => {
    const rule = rules.find((r) => r.id === id);
    expect(compileStep(rule)(event)).toBe(expected);
  });

  it('keeps `on` as the step key (YAML 1.2), so example rules compile', () => {
    const rule = rules[0];
    expect(Object.keys(rule)).toContain('on');
    expect(() => compileStep(rule)).not.toThrow();
  });

  it.each([
    [key(' ', 1), true],
    [key('f', 1), false],
    [ev('input.key.up', { key: ' ' }), false],
  ])('space_done on %j -> %s', (event, expected) => {
    expect(compileStep(exampleRule('space_done').match)(event)).toBe(expected);
  });

  it('distractor_tap matches taps on distractors only', () => {
    const step = compileStep(exampleRule('distractor_tap').match);
    expect(step(tap(1, 'distractor', 0))).toBe(true);
    expect(step(tap(1, 'target', 0))).toBe(false);
    expect(step(tap(null, null, 0))).toBe(false);
  });
});

describe('steps', () => {
  it.each([
    [{ on: 'input.tap' }, ev('input.tap'), true],
    [{ on: 'input.tap' }, ev('input.longpress.start'), false],
    [{ on: 'input.*' }, ev('input.key.down'), true],
    [{ on: 'input.*' }, ev('phase.onset'), false],
    [{ on: 'input.tap', where: { 'target.role': 'target' } }, tap(1, 'target', 0), true],
    [{ on: 'input.tap', where: { 'target.role': 'target' } }, tap(null, null, 0), false],
    [{ on: 'phase.onset', where: { trial: 3 } }, ev('phase.onset', { phase: 'p' }, 0, { trial: 3 }), true],
    [{ on: 'phase.onset', where: { phase: 'p' } }, ev('phase.onset', { phase: 'p' }), true],
    [{ on: 'input.gaze.dwell', min_ms: 100 }, ev('input.gaze.dwell', { duration_ms: 120 }), true],
    [{ on: 'input.gaze.dwell', min_ms: 100 }, ev('input.gaze.dwell', { duration_ms: 80 }), false],
    [{ on: 'input.gaze.dwell', min_ms: 100 }, ev('input.gaze.dwell', {}), false],
  ])('%j on %j -> %s', (step, event, expected) => {
    expect(compileStep(step)(event)).toBe(expected);
  });
});

describe('patterns: single step', () => {
  it('returns the event and its time on every match', () => {
    const matcher = createPatternMatcher({ on: 'input.key.down', where: { key: ' ' } });
    expect(matcher.feed(key('a', 10))).toBeNull();
    const result = matcher.feed(key(' ', 20));
    expect(result.events).toHaveLength(1);
    expect(result).toMatchObject({ t_first: 20, t_last: 20 });
    expect(matcher.feed(key(' ', 30))).not.toBeNull();
  });
});

describe('patterns: ordered sequences', () => {
  const twoTaps = exampleRule('two_taps').match;

  it('example rule two_taps: two taps on distinct targets', () => {
    expect(twoTaps.distinct_by).toBe('target.id');
  });

  const table = [
    ['two distinct targets', twoTaps, [tap(1, 'target', 0), tap(2, 'target', 100)], [1]],
    ['same target twice never completes', twoTaps, [tap(1, 'target', 0), tap(1, 'target', 100)], []],
    ['same target then a different one', twoTaps, [tap(1, 'target', 0), tap(1, 'target', 50), tap(2, 'target', 100)], [2]],
    ['a distractor tap in between is ignored', twoTaps, [tap(1, 'target', 0), tap(9, 'distractor', 50), tap(2, 'target', 100)], [2]],
    ['taps on nothing are ignored', twoTaps, [tap(1, 'target', 0), tap(null, null, 50), tap(2, 'target', 100)], [2]],
    ['other event types are ignored', twoTaps, [tap(1, 'target', 0), key('a', 50), tap(2, 'target', 100)], [1 + 1]],
    ['it starts over after completing', twoTaps, [tap(1, 'target', 0), tap(2, 'target', 1), tap(3, 'target', 2), tap(4, 'target', 3)], [1, 3]],
    ['a repeat after completing needs two new distinct targets', twoTaps, [tap(1, 'target', 0), tap(2, 'target', 1), tap(2, 'target', 2)], [1]],
    ['without distinct_by the same target counts twice',
      { sequence: twoTaps.sequence }, [tap(1, 'target', 0), tap(1, 'target', 100)], [1]],
    ['within: second tap too late',
      { ...twoTaps, within: '5s' }, [tap(1, 'target', 0), tap(2, 'target', 6000)], []],
    ['within: second tap in time',
      { ...twoTaps, within: '5s' }, [tap(1, 'target', 0), tap(2, 'target', 4000)], [1]],
    ['within: the window is inclusive',
      { ...twoTaps, within: 5000 }, [tap(1, 'target', 0), tap(2, 'target', 5000)], [1]],
    ['within: any distinct partner inside the window completes',
      { ...twoTaps, within: '5s' }, [tap(1, 'target', 0), tap(3, 'target', 4000), tap(2, 'target', 8000)], [1]],
    ['within: a later first tap restarts the window',
      { ...twoTaps, within: '5s' }, [tap(1, 'target', 0), tap(1, 'target', 6000), tap(2, 'target', 8000)], [2]],
    ['within: expired partial and a same-target repeat',
      { ...twoTaps, within: '5s' }, [tap(1, 'target', 0), tap(1, 'target', 4000), tap(2, 'target', 8000)], [2]],
    ['three steps in order, with noise',
      { sequence: [{ on: 'input.key.down', where: { key: 'a' } }, { on: 'input.key.down', where: { key: 'b' } }, { on: 'input.key.down', where: { key: 'c' } }] },
      [key('a', 0), key('x', 1), key('b', 2), key('a', 3), key('c', 4)], [4]],
    ['three steps out of order never complete',
      { sequence: [{ on: 'input.key.down', where: { key: 'a' } }, { on: 'input.key.down', where: { key: 'b' } }, { on: 'input.key.down', where: { key: 'c' } }] },
      [key('c', 0), key('b', 1), key('a', 2)], []],
    ['steps of different event types',
      { sequence: [{ on: 'input.key.down' }, { on: 'input.tap' }] }, [tap(1, 't', 0), key('a', 1), tap(1, 't', 2)], [2]],
  ];
  it.each(table)('%s', (_label, pattern, events, expected) => {
    expect(completions(pattern, events)).toEqual(expected);
  });

  it('reports the matched events in order with their times', () => {
    const matcher = createPatternMatcher(twoTaps);
    matcher.feed(tap(1, 'target', 100));
    const result = matcher.feed(tap(2, 'target', 250));
    expect(result.events.map((e) => e.data.target.id)).toEqual([1, 2]);
    expect(result).toMatchObject({ t_first: 100, t_last: 250 });
  });

  it('reset() discards partial matches', () => {
    const matcher = createPatternMatcher(twoTaps);
    matcher.feed(tap(1, 'target', 0));
    matcher.reset();
    expect(matcher.feed(tap(2, 'target', 10))).toBeNull();
  });

  it('needs the frame time when `within` is given in frames', () => {
    const pattern = { ...twoTaps, within: { frames: 60 } };
    expect(() => createPatternMatcher(pattern)).toThrow(TypeError);
    expect(completions(pattern, [tap(1, 'target', 0), tap(2, 'target', 900)], { frameMs: 16 })).toEqual([1]);
    expect(completions(pattern, [tap(1, 'target', 0), tap(2, 'target', 1000)], { frameMs: 16 })).toEqual([]);
  });

  it('treats a missing distinct_by field as not distinct', () => {
    const pattern = { sequence: [{ on: 'input.tap' }, { on: 'input.tap' }], distinct_by: 'target.id' };
    expect(completions(pattern, [tap(null, null, 0), tap(null, null, 1)])).toEqual([]);
  });

  it('does not grow without bound on a long stream with no `within`', () => {
    const matcher = createPatternMatcher({ sequence: [{ on: 'input.key.down', where: { key: 'a' } }, { on: 'input.key.down', where: { key: 'b' } }] });
    for (let i = 0; i < 10_000; i += 1) matcher.feed(key('a', i));
    expect(matcher.feed(key('b', 10_000))).not.toBeNull();
  });
});

describe('patterns: unordered sequences', () => {
  const a = { on: 'input.key.down', where: { key: 'a' } };
  const b = { on: 'input.key.down', where: { key: 'b' } };
  const table = [
    ['either order (b then a)', { sequence: [a, b], unordered: true }, [key('b', 0), key('a', 1)], [1]],
    ['either order (a then b)', { sequence: [a, b], unordered: true }, [key('a', 0), key('b', 1)], [1]],
    ['the same key twice is not enough', { sequence: [a, b], unordered: true }, [key('a', 0), key('a', 1)], []],
    ['a repeat before the partner is fine', { sequence: [a, b], unordered: true }, [key('a', 0), key('a', 1), key('b', 2)], [2]],
    ['within applies', { sequence: [a, b], unordered: true, within: '1s' }, [key('a', 0), key('b', 1500)], []],
    ['within: an old event is dropped', { sequence: [a, b], unordered: true, within: '1s' }, [key('a', 0), key('a', 1200), key('b', 1500)], [2]],
    ['it starts over after completing', { sequence: [a, b], unordered: true }, [key('a', 0), key('b', 1), key('b', 2), key('a', 3)], [1, 3]],
    ['unrelated events are ignored', { sequence: [a, b], unordered: true }, [key('a', 0), key('z', 1), tap(1, 't', 2), key('b', 3)], [3]],
  ];
  it.each(table)('%s', (_label, pattern, events, expected) => {
    expect(completions(pattern, events)).toEqual(expected);
  });

  it('finds an assignment when one event could fill either step', () => {
    // A greedy first-fit would give the target tap to step 1 and then fail to fill step 2.
    const anyTap = { on: 'input.tap' };
    const targetTap = { on: 'input.tap', where: { 'target.role': 'target' } };
    const pattern = { sequence: [anyTap, targetTap], unordered: true };
    expect(completions(pattern, [tap(1, 'target', 0), tap(2, 'distractor', 1)])).toEqual([1]);
  });

  it('honours distinct_by', () => {
    const tapStep = { on: 'input.tap' };
    const pattern = { sequence: [tapStep, tapStep], unordered: true, distinct_by: 'target.id' };
    expect(completions(pattern, [tap(1, 't', 0), tap(1, 't', 1), tap(2, 't', 2)])).toEqual([2]);
  });

  it('returns the matched events in time order', () => {
    const matcher = createPatternMatcher({ sequence: [a, b], unordered: true });
    matcher.feed(key('b', 5));
    const result = matcher.feed(key('a', 9));
    expect(result.events.map((e) => e.data.key)).toEqual(['b', 'a']);
    expect(result).toMatchObject({ t_first: 5, t_last: 9 });
  });
});
