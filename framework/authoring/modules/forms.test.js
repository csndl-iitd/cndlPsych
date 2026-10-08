import { describe, expect, it } from 'vitest';
import {
  predicateToExpression, questionElement, sessionAnswers, sessionElements, subjectAnswers, subjectElements, surveyJson,
} from './forms.js';

describe('predicateToExpression', () => {
  it.each([
    [{ strategy: 'Yes' }, "{strategy} = 'Yes'"],
    [{ n: 3 }, '{n} = 3'],
    [{ ok: true }, '{ok} = true'],
    [{ strategy: ['a', 'b'] }, "({strategy} = 'a' or {strategy} = 'b')"],
    [{ age: { gte: 18 } }, '{age} >= 18'],
    [{ age: { gte: 18, lt: 65 } }, '({age} >= 18 and {age} < 65)'],
    [{ x: { ne: 'no' } }, "{x} != 'no'"],
    [{ x: { in: ['a', 'b'] } }, "({x} = 'a' or {x} = 'b')"],
    [{ x: { not_in: ['a', 'b'] } }, "({x} != 'a' and {x} != 'b')"],
    [{ x: { exists: true } }, '{x} notempty'],
    [{ x: { exists: false } }, '{x} empty'],
    [{ x: null }, '{x} empty'],
    [{ a: 1, b: 2 }, '({a} = 1 and {b} = 2)'],
    [{ all: [{ a: 1 }, { b: 2 }] }, '({a} = 1 and {b} = 2)'],
    [{ any: [{ a: 1 }, { b: 2 }] }, '({a} = 1 or {b} = 2)'],
    [{ not: { a: 1 } }, 'not ({a} = 1)'],
    [{ a: "it's" }, "{a} = 'it\\'s'"],
  ])('%j', (predicate, expected) => {
    expect(predicateToExpression(predicate)).toBe(expected);
  });

  it('rejects operators a form cannot express', () => {
    expect(() => predicateToExpression({ x: { regex: '^a' } })).toThrow(/not supported/);
  });
});

describe('questionElement', () => {
  const base = { name: 'q', prompt: 'Question?' };

  it.each([
    ['text', { type: 'text' }, { type: 'text' }],
    ['default type is text', {}, { type: 'text' }],
    ['textarea', { type: 'textarea', rows: 6 }, { type: 'comment', rows: 6 }],
    ['number', { type: 'number', min: 1, max: 9 }, { type: 'text', inputType: 'number', min: 1, max: 9 }],
    ['date', { type: 'date' }, { type: 'text', inputType: 'date' }],
    ['multi-choice', { type: 'multi-choice', options: ['a', 'b'] }, { type: 'radiogroup', choices: ['a', 'b'] }],
    ['multi-select', { type: 'multi-select', options: ['a', 'b'] }, { type: 'checkbox', choices: ['a', 'b'] }],
    ['dropdown with labels', { type: 'dropdown', options: [{ value: 1, label: 'One' }, 'two'] }, { type: 'dropdown', choices: [{ value: 1, text: 'One' }, 'two'] }],
  ])('%s', (_label, question, expected) => {
    expect(questionElement({ ...base, ...question })).toMatchObject({ name: 'q', title: 'Question?', ...expected });
  });

  it('likert becomes a button rating with end labels', () => {
    const element = questionElement({ ...base, type: 'likert', scale: { min: 1, max: 7, labels: { min: 'Easy', max: 'Hard' } } });
    expect(element).toMatchObject({ type: 'rating', displayMode: 'buttons', rateMin: 1, rateMax: 7, rateCount: 7, minRateDescription: 'Easy', maxRateDescription: 'Hard' });
    expect(element).not.toHaveProperty('rateValues');
  });

  it('carries required, help, default, placeholder, pattern and show_if', () => {
    const element = questionElement({ ...base, required: true, help: 'Hint', default: 'x', placeholder: 'type', pattern: '^a', show_if: { other: 'Yes' } });
    expect(element).toMatchObject({ isRequired: true, description: 'Hint', defaultValue: 'x', placeholder: 'type', visibleIf: "{other} = 'Yes'" });
    expect(element.validators).toContainEqual({ type: 'regex', regex: '^a' });
  });

  it('text length limits become one validator, only when given', () => {
    expect(questionElement({ ...base, min: 2, max: 5 }).validators).toContainEqual({ type: 'text', minLength: 2, maxLength: 5 });
    expect(questionElement({ ...base }).validators).toEqual([]);
  });

  it('rejects an unknown type', () => {
    expect(() => questionElement({ ...base, type: 'slider' })).toThrow(/unknown question type/);
  });
});

describe('surveyJson', () => {
  it('builds one page without a completed page, with the submit label', () => {
    expect(surveyJson({ title: 'T', intro: 'I', questions: [{ name: 'q' }], submitLabel: 'Go' })).toEqual({
      title: 'T', description: 'I', showQuestionNumbers: 'off', completeText: 'Go', showCompletedPage: false, elements: [{ name: 'q' }],
    });
    expect(surveyJson({ questions: [] })).toMatchObject({ completeText: 'Continue' });
  });
});

describe('built-in subject form', () => {
  it('has subject_id, sex and age in front, then the extras from forms.yaml', () => {
    const elements = subjectElements({ questions: [{ name: 'handedness', prompt: 'Hand', type: 'multi-choice', options: ['right', 'left'] }] });
    expect(elements.map((e) => e.name)).toEqual(['subject_id', 'sex', 'age', 'handedness']);
    expect(elements.slice(0, 3).every((e) => e.isRequired)).toBe(true);
    expect(elements[1].choices.map((c) => c.value)).toEqual(['male', 'female']);
  });

  it('applies overrides to prompts, help, requiredness, options and numeric bounds', () => {
    const elements = subjectElements({
      overrides: {
        subject_id: { prompt: 'Code', placeholder: '001' },
        sex: { options: [{ value: 'male', label: 'M' }, { value: 'female', label: 'F' }] },
        age: { required: false, min: 18, max: 99, help: 'years' },
      },
    });
    expect(elements[0]).toMatchObject({ title: 'Code', placeholder: '001' });
    expect(elements[1].choices).toEqual([{ value: 'male', text: 'M' }, { value: 'female', text: 'F' }]);
    expect(elements[2]).toMatchObject({ isRequired: false, description: 'years' });
    expect(elements[2].validators.at(-1).expression).toBe('{age} empty or ({age} >= 18 and {age} <= 99)');
  });

  it('validates ids with a pattern that matches what the session record accepts', () => {
    const [id] = subjectElements();
    const idPattern = new RegExp(id.validators[0].regex);
    expect(['007', 'sub-007', 'AB9'].every((v) => idPattern.test(v))).toBe(true);
    expect(['sub_1', 'a b', ''].some((v) => idPattern.test(v))).toBe(false);
  });

  it('puts no limit on age: a number input, no pattern, no maximum, no minimum except zero', () => {
    const [, , age] = subjectElements();
    expect(age).toMatchObject({ type: 'text', inputType: 'number', min: 0, isRequired: true, validators: [] });
    expect(age.max).toBeUndefined();
  });

  it('shows short choices in one row and long ones as a list', () => {
    const [, sex] = subjectElements();
    expect(sex.colCount).toBe(0);
    const long = questionElement({ name: 'q', prompt: 'Q', type: 'multi-choice', options: ['a very long answer that needs its own line', 'b'] });
    expect(long.colCount).toBeUndefined();
    expect(questionElement({ name: 'q', prompt: 'Q', type: 'multi-choice', options: ['1', '2', '3', '4', '5'] }).colCount).toBeUndefined();
  });
});

describe('built-in session form', () => {
  it('has session_id (default 01) then extras', () => {
    const elements = sessionElements({ questions: [{ name: 'session_type', prompt: 'Type', type: 'dropdown', options: ['Control', 'Experimental'] }] });
    expect(elements.map((e) => e.name)).toEqual(['session_id', 'session_type']);
    expect(elements[0]).toMatchObject({ defaultValue: '01', isRequired: true });
  });
});

describe('answers', () => {
  it('subjectAnswers: BIDS id, numeric age, extras kept', () => {
    expect(subjectAnswers({ subject_id: '007', sex: 'female', age: '24', handedness: 'right' })).toEqual({
      subjectId: 'sub-007', subject: { sex: 'female', age: 24, handedness: 'right' },
    });
    expect(subjectAnswers({ subject_id: 'sub-A1', sex: 'male', age: '' })).toEqual({ subjectId: 'sub-A1', subject: { sex: 'male', age: undefined } });
    expect(subjectAnswers({ subject_id: '1', sex: 'male', age: '104.5' }).subject.age).toBe(104.5);
    expect(subjectAnswers({ subject_id: 'bad id', sex: 'male', age: '3' }).subjectId).toBeNull();
  });

  it('sessionAnswers: BIDS id and the remaining fields', () => {
    expect(sessionAnswers({ session_id: '01', session_type: 'Control' })).toEqual({ sessionId: 'ses-01', sessionFields: { session_type: 'Control' } });
  });
});
