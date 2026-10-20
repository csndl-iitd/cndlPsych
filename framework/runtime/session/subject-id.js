// The subject form in experimenter (controlled) mode, where the participant number comes from Firebase.
// The next free number is filled in. The experimenter may type another one, for example to continue a
// participant who stopped or to fill a gap, but is warned and has to confirm; a number that is already
// in use is refused here, before anything else is asked.
import { subjectElements } from '../../authoring/modules/forms.js';
import { askAction, showForm } from '../../authoring/modules/survey.js';

const confirmation = (suggested, typed) => `## Use a different participant ID?

The next free participant ID is **${suggested}**, but you entered **${typed}**.

Use another ID only on purpose, for example to continue a participant who stopped or to fill a gap. It will be recorded in the log that the suggestion was overridden, and a number that is already in use is refused.`;

const inUse = (typed) => `## Participant ID in use

**${typed}** has already been used in this experiment. Choose another ID.`;

/** The form's questions with the answers given before filled in (after the experimenter went back). */
const withAnswers = (elements, values) => (values ? elements.map((element) => ({ ...element, defaultValue: values[element.name] ?? element.defaultValue })) : elements);

/**
 * @param {{forms: object, screen: object, remote: object|null, assigned: object}} options `assigned` is from assignedSubject (remote.js)
 * @returns {Promise<{subjectForm: {values: object, durationMs: number}, overridden?: {suggested: string, used: string}}>}
 */
export async function askSubjectForm({ forms, screen, remote, assigned }) {
  let previous = null;
  for (;;) {
    const subjectForm = await showForm(screen, { title: forms.subject?.title ?? 'About you', intro: forms.subject?.intro, elements: withAnswers(subjectElements(forms.subject, assigned), previous) });
    const typed = String(subjectForm.values.subject_id ?? '').trim();
    const differs = assigned.overridable && remote.numberOf(typed) !== assigned.n;
    if (!differs) return { subjectForm };
    if (await remote.isTaken(typed)) {
      await askAction(screen, { message: inUse(typed), choices: [{ value: 'back', text: 'Change the ID' }] });
    } else if ((await askAction(screen, {
      message: confirmation(assigned.value, typed),
      choices: [{ value: 'back', text: 'Go back and change it' }, { value: 'use', text: `Use ${typed}` }],
    })) === 'use') {
      return { subjectForm, overridden: { suggested: assigned.value, used: typed } };
    }
    previous = subjectForm.values;
  }
}
