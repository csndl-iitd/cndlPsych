// forms.yaml -> SurveyJS JSON (the format @jspsych/plugin-survey renders), the built-in
// subject and session forms, and turning the answers back into values the framework uses.
import { normalizeSessionId, normalizeSubjectId } from '../../foundation/session.js';

// Biological sex, as BIDS records it. forms.yaml can change the options (`overrides.sex.options`).
const SEX_OPTIONS = [
  { value: 'male', text: 'Male' },
  { value: 'female', text: 'Female' },
];
const quote = (value) => (typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : String(value));

// ---- show_if predicate -> SurveyJS expression ---------------------------------------
const OPERATORS = { eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function conditionExpression(name, condition) {
  const ref = `{${name}}`;
  if (condition === null) return `${ref} empty`;
  if (Array.isArray(condition)) return `(${condition.map((value) => `${ref} = ${quote(value)}`).join(' or ')})`;
  if (typeof condition !== 'object') return `${ref} = ${quote(condition)}`;
  const parts = Object.entries(condition).map(([operator, argument]) => {
    if (operator in OPERATORS) return `${ref} ${OPERATORS[operator]} ${quote(argument)}`;
    if (operator === 'in') return `(${argument.map((value) => `${ref} = ${quote(value)}`).join(' or ')})`;
    if (operator === 'not_in') return `(${argument.map((value) => `${ref} != ${quote(value)}`).join(' and ')})`;
    if (operator === 'exists') return argument ? `${ref} notempty` : `${ref} empty`;
    throw new TypeError(`show_if operator "${operator}" is not supported in forms`);
  });
  return parts.length === 1 ? parts[0] : `(${parts.join(' and ')})`;
}

/** A forms.yaml predicate over earlier answers as a SurveyJS visibleIf expression. */
export function predicateToExpression(predicate) {
  const parts = Object.entries(predicate).map(([key, value]) => {
    if (key === 'not') return `not (${predicateToExpression(value)})`;
    if (key === 'all') return `(${value.map(predicateToExpression).join(' and ')})`;
    if (key === 'any') return `(${value.map(predicateToExpression).join(' or ')})`;
    return conditionExpression(key, value);
  });
  return parts.length === 1 ? parts[0] : `(${parts.join(' and ')})`;
}

// ---- questions ---------------------------------------------------------------------
const choiceOf = (option) => (typeof option === 'string' ? option : { value: option.value, text: option.label });

const SHORT_CHOICE = 18;
/** A few short choices fit in one row; a long list or long texts stay one per line. */
const inline = (choices) => (choices.length <= 4 && choices.every((choice) => String(choice.text ?? choice).length <= SHORT_CHOICE) ? { colCount: 0 } : {});

/** One forms.yaml question as a SurveyJS element. */
export function questionElement(question) {
  const element = {
    name: question.name,
    title: question.prompt,
    isRequired: Boolean(question.required),
    ...(question.help ? { description: question.help } : {}),
    ...(question.default === undefined ? {} : { defaultValue: question.default }),
    ...(question.show_if ? { visibleIf: predicateToExpression(question.show_if) } : {}),
  };
  const validators = question.pattern ? [{ type: 'regex', regex: question.pattern }] : [];
  switch (question.type ?? 'text') {
    case 'text': {
      const length = Object.fromEntries([['minLength', question.min], ['maxLength', question.max]].filter(([, value]) => value !== undefined));
      return { ...element, type: 'text', ...(question.placeholder ? { placeholder: question.placeholder } : {}),
        validators: [...validators, ...(Object.keys(length).length ? [{ type: 'text', ...length }] : [])] };
    }
    case 'textarea': return { ...element, type: 'comment', rows: question.rows ?? 4, ...(question.placeholder ? { placeholder: question.placeholder } : {}), validators };
    case 'number': return { ...element, type: 'text', inputType: 'number', ...(question.min === undefined ? {} : { min: question.min }), ...(question.max === undefined ? {} : { max: question.max }), ...(question.unit ? { description: question.unit } : {}) };
    case 'multi-choice': {
      const choices = question.options.map(choiceOf);
      return { ...element, type: 'radiogroup', choices, ...inline(choices) };
    }
    case 'multi-select': return { ...element, type: 'checkbox', choices: question.options.map(choiceOf) };
    case 'dropdown': return { ...element, type: 'dropdown', choices: question.options.map(choiceOf) };
    case 'likert': {
      const { min, max, labels = {} } = question.scale;
      return { ...element, type: 'rating', displayMode: 'buttons', rateMin: min, rateMax: max, rateCount: max - min + 1,
        ...(labels.min ? { minRateDescription: labels.min } : {}), ...(labels.max ? { maxRateDescription: labels.max } : {}) };
    }
    case 'date': return { ...element, type: 'text', inputType: 'date' };
    default: throw new TypeError(`unknown question type "${question.type}"`);
  }
}

/** A whole form as SurveyJS JSON (one page, no completed page: the lifecycle moves on). */
export function surveyJson({ title, intro, questions, submitLabel }) {
  return {
    ...(title ? { title } : {}),
    ...(intro ? { description: intro } : {}),
    showQuestionNumbers: 'off',
    completeText: submitLabel ?? 'Continue',
    showCompletedPage: false,
    elements: questions,
  };
}

// ---- built-in subject / session forms ----------------------------------------------------
function withOverride(element, override = {}) {
  const next = { ...element };
  if (override.prompt) next.title = override.prompt;
  if (override.help) next.description = override.help;
  if (override.placeholder) next.placeholder = override.placeholder;
  if (override.required !== undefined) next.isRequired = override.required;
  if (override.options) {
    next.choices = override.options.map(choiceOf);
    Object.assign(next, inline(next.choices));
  }
  return next;
}

/**
 * The questions of the built-in `subject` form: subject_id, sex, age, then forms.yaml extras.
 * @param {object} [form] forms.yaml `subject`
 * @param {{value?: string, locked?: boolean, hidden?: boolean}} [assigned] a subject ID chosen by the
 *   storage backend: prefilled (and read-only when `locked`), or left out of the form when `hidden`
 */
export function subjectElements(form = {}, assigned = {}) {
  const { overrides = {}, questions = [] } = form;
  // Any age is accepted here; an experiment that needs a minimum says so (consent.min_age) or bounds it (overrides.age.min / max).
  const age = withOverride({
    type: 'text', inputType: 'number', name: 'age', title: 'Age (years)', isRequired: true, min: 0, validators: [],
  }, overrides.age);
  const bounds = [overrides.age?.min !== undefined ? `{age} >= ${overrides.age.min}` : null, overrides.age?.max !== undefined ? `{age} <= ${overrides.age.max}` : null].filter(Boolean);
  if (bounds.length) age.validators.push({ type: 'expression', expression: `{age} empty or (${bounds.join(' and ')})`, text: 'Please check your age' });
  // With a number from Firebase the ID must be a number; the experimenter may change the suggestion, and is told it is one.
  const numbered = assigned.value !== undefined;
  const subjectId = withOverride({
    type: 'text', name: 'subject_id', title: 'Participant ID', isRequired: true,
    ...(assigned.overridable ? { description: `Suggested: ${assigned.value}. You can type another number if you need to; you will be asked to confirm it.` } : {}),
    validators: [numbered
      ? { type: 'regex', regex: '^(sub-)?[0-9]+$', text: 'Use a number (for example 007)' }
      : { type: 'regex', regex: '^(sub-)?[A-Za-z0-9]+$', text: 'Use letters and digits only (for example 007)' }],
  }, overrides.subject_id);
  if (assigned.value !== undefined) Object.assign(subjectId, { defaultValue: assigned.value, readOnly: assigned.locked === true });
  else if (assigned.defaultValue !== undefined) subjectId.defaultValue = assigned.defaultValue; // an ID filled in, not claimed (test mode)
  return [
    ...(assigned.hidden ? [] : [subjectId]),
    withOverride({ type: 'radiogroup', name: 'sex', title: 'Sex', isRequired: true, choices: SEX_OPTIONS, ...inline(SEX_OPTIONS) }, overrides.sex),
    age,
    ...questions.map(questionElement),
  ];
}

/**
 * The questions of the built-in `session` form: session_id, then forms.yaml extras.
 * @param {object} [form] forms.yaml `session`
 * @param {{suggested?: string}} [options] `suggested` is the session ID to fill in ("ses-02" for a participant who already has ses-01)
 */
export function sessionElements(form = {}, { suggested } = {}) {
  const { overrides = {}, questions = [] } = form;
  return [
    withOverride({
      type: 'text', name: 'session_id', title: 'Session', isRequired: true, defaultValue: suggested ? suggested.replace(/^ses-/, '') : '01',
      validators: [{ type: 'regex', regex: '^(ses-)?[A-Za-z0-9]+$', text: 'Use letters and digits only (for example 01)' }],
    }, overrides.session_id),
    ...questions.map(questionElement),
  ];
}

const parseAge = (value) => (value === undefined || value === null || value === '' ? undefined : Number(value));

/**
 * Subject form answers -> { subjectId, subject: {sex, age, ...extras} } (BIDS participants.tsv columns).
 * @param {object} values
 * @param {string} [assignedId] the subject ID the storage backend assigned, when the form did not ask
 * @returns {{subjectId: string|null, subject: object}}
 */
export function subjectAnswers(values, assignedId) {
  const { subject_id: id = assignedId, sex, age, ...extras } = values;
  return { subjectId: normalizeSubjectId(id), subject: { sex, age: parseAge(age), ...extras } };
}

/** Session form answers -> { sessionId, sessionFields }. */
export function sessionAnswers(values) {
  const { session_id: id, ...extras } = values;
  return { sessionId: normalizeSessionId(id), sessionFields: extras };
}
