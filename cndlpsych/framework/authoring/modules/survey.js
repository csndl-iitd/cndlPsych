// The survey module and the built-in screens (consent, subject and session forms). All of
// them are @jspsych/plugin-survey trials: the participant interacts with SurveyJS, so none
// of our code attaches DOM listeners, and typed answers never reach the event log
// (form.submitted for built-in forms carries no values: they go into the session record).
import survey from '@jspsych/plugin-survey';
import { questionElement, surveyJson } from './forms.js';
import { markdownToHtml } from './markdown.js';

const html = (markup) => ({ type: 'html', name: `html_${markup.length}`, html: markup });

async function showSurvey(ctx, json) {
  await ctx.jsPsych.run([{ type: survey, survey_json: json }]);
  const [result] = ctx.jsPsych.data.get().last(1).values();
  return { values: result.response, durationMs: result.rt };
}

/**
 * Show a form and resolve with its answers.
 * @param {import('./phase.js').ModuleContext} ctx
 * @param {{title?: string, intro?: string, elements: object[], submitLabel?: string}} form SurveyJS elements
 * @returns {Promise<{values: object, durationMs: number}>}
 */
export function showForm(ctx, { title, intro, elements, submitLabel }) {
  const introElement = intro ? [html(markdownToHtml(intro))] : [];
  return showSurvey(ctx, surveyJson({ title, questions: [...introElement, ...elements], submitLabel }));
}

/**
 * Ask the participant (or experimenter) to pick one action, e.g. connect a device or retry.
 * The click on the submit button is the user gesture browsers require for device pickers.
 * @param {{message: string, choices: {value: string, text: string}[], submitLabel?: string}} options markdown message
 * @returns {Promise<string>} the chosen value
 */
export async function askAction(ctx, { message, choices, submitLabel = 'Continue' }) {
  const elements = [
    html(markdownToHtml(message)),
    { type: 'radiogroup', name: 'action', title: 'Choose', showTitle: false, isRequired: true, defaultValue: choices[0].value, choices },
  ];
  const { values } = await showSurvey(ctx, surveyJson({ questions: elements, submitLabel }));
  return values.action;
}

/**
 * A list of items with checkboxes (including a built-in "Select all"), followed by one action.
 * Used by the local data manager. The selection and the chosen action come back together.
 * @param {{message: string, items: {value: string, text: string}[], actions: {value: string, text: string}[], submitLabel?: string}} options
 * @returns {Promise<{selected: string[], action: string}>}
 */
export async function askSelection(ctx, { message, items, actions, submitLabel = 'Continue' }) {
  const elements = [
    html(markdownToHtml(message)),
    { type: 'checkbox', name: 'selected', title: 'Stored sessions', choices: items, showSelectAllItem: true, selectAllText: 'Select all', colCount: 1 },
    { type: 'radiogroup', name: 'action', title: 'What to do with the selected sessions', isRequired: true, defaultValue: actions[0].value, choices: actions },
  ];
  const { values } = await showSurvey(ctx, surveyJson({ questions: elements, submitLabel }));
  return { selected: values.selected ?? [], action: values.action };
}

/**
 * The consent screen: the text, a decision, and one checkbox per statement (required unless
 * `required: false`), which only appear once the participant agrees.
 * @returns {Promise<{agreed: boolean, statements: Record<string, boolean>}>}
 */
export async function showConsent(ctx, { markdown, mode = 'on_screen', statements = [] }) {
  const intro = mode === 'attested' ? '*The experimenter confirms that the participant has been informed and has consented.*' : '';
  const agree = "{decision} = 'agree'";
  const elements = [
    html(markdownToHtml(`${markdown}\n\n${intro}`)),
    {
      type: 'radiogroup', name: 'decision', title: mode === 'attested' ? 'Consent was obtained' : 'Do you agree to take part?', isRequired: true,
      choices: [{ value: 'agree', text: mode === 'attested' ? 'Yes, consent was obtained' : 'I agree to take part' }, { value: 'decline', text: mode === 'attested' ? 'No' : 'I do not agree' }],
    },
    ...statements.map((statement) => ({
      type: 'checkbox', name: `statement_${statement.id}`, title: statement.id, visibleIf: agree, isRequired: statement.required !== false,
      choices: [{ value: 'yes', text: statement.text }], showTitle: false,
    })),
  ];
  const { values } = await showSurvey(ctx, surveyJson({ questions: elements, submitLabel: 'Continue' }));
  return {
    agreed: values.decision === 'agree',
    statements: Object.fromEntries(statements.map((s) => [s.id, Array.isArray(values[`statement_${s.id}`]) && values[`statement_${s.id}`].includes('yes')])),
  };
}

/**
 * A `survey` block: one form from forms.yaml; emits form.submitted with the answers.
 * @param {import('./phase.js').ModuleContext} ctx
 * @returns {{nodes: object[], nTrials: number}}
 */
export function buildSurvey(ctx, planBlock) {
  const { form_id: formId, submit_label: submitLabel } = planBlock.config;
  const form = ctx.plan.forms.forms.find((candidate) => candidate.id === formId);
  if (!form) throw new Error(`survey block "${planBlock.id}" refers to unknown form "${formId}"`);
  const elements = form.questions.map(questionElement);
  const intro = form.intro ? [html(markdownToHtml(form.intro))] : [];
  const json = surveyJson({ title: form.title, questions: [...intro, ...elements], submitLabel: submitLabel ?? form.submit_label });

  return {
    nTrials: 0,
    nodes: [{
      type: survey,
      survey_json: json,
      on_start() { ctx.applyScope(ctx.inputScope(planBlock.input)); },
      on_finish(data) {
        ctx.bus.emit({ source: 'system', type: 'form.submitted', data: { form_id: formId, values: data.response, duration_ms: data.rt } });
      },
    }],
  };
}
