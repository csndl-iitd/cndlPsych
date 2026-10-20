// The subject form in experimenter (controlled) mode, where the participant number comes from Firebase.
// The next free number is filled in. The experimenter may type another one, and is told what that means:
//  - a free number that is not the suggestion: a warning, and a confirmation;
//  - a number that was used before (a new session of the same participant, or a number knowingly used
//    again): the participant's details (sex, age, ...) from their latest earlier session are filled in, to be
//    checked and changed where needed, and the next session number is suggested.
import { subjectElements } from '../../authoring/modules/forms.js';
import { askAction, showForm } from '../../authoring/modules/survey.js';
import { mergeSessions, summarizeHistory } from '../subject-history.js';

const different = (suggested, typed) => `## Use a different participant ID?

The next free participant ID is **${suggested}**, but you entered **${typed}**.

Use another ID only on purpose, for example to continue a participant who stopped or to fill a gap. It will be recorded in the log that the suggestion was overridden.`;

const earlier = (typed, history) => `## ${typed} has been used before

${history.sessions
    ? `This participant already has ${history.sessions === 1 ? 'one session' : `${history.sessions} sessions`} in this experiment (${history.sessionIds.join(', ')}).`
    : 'This ID was claimed before, but no earlier session of it was found.'}

Use it for **another session of the same participant**, or to reuse the ID knowingly. Their details are filled in from the earlier session so you can check them and change what is different; nothing already stored is changed.`;

const filledIn = (typed, history) => (history.from
  ? `Details of **${typed}** were filled in from session **${history.from.session_id}**${history.from.started_at ? ` (${String(history.from.started_at).slice(0, 10)})` : ''}. Check them and change what is different.`
  : null);

/** The form's questions with answers filled in. */
const withAnswers = (elements, values) => (values ? elements.map((element) => ({ ...element, defaultValue: values[element.name] ?? element.defaultValue })) : elements);

/**
 * What is stored under this ID: the sessions in Firebase and in this browser.
 * @param {{remote: object, local?: object}} stores
 */
async function historyOf({ remote, local }, typed) {
  const label = remote.labelOf(typed);
  const [online, onThisDevice] = await Promise.all([
    remote.history(typed),
    local?.listSessions ? local.listSessions().then((rows) => rows.filter((row) => row.record.subject_id === label).map((row) => ({ session_id: row.record.session_id, started_at: row.record.started_at, subject: row.record.subject }))) : [],
  ]);
  return summarizeHistory(mergeSessions(online, onThisDevice));
}

/**
 * @param {{forms: object, screen: object, remote: object|null, assigned: object, local?: object}} options `assigned` is from assignedSubject (remote.js)
 * @returns {Promise<{subjectForm: {values: object, durationMs: number}, overridden?: {suggested: string, used: string}, reused?: {id: string, history: object}}>}
 */
export async function askSubjectForm({ forms, screen, remote, assigned, local }) {
  let previous = null;
  let note = null;
  let confirmed = null;
  let reused = null;
  const intro = () => [forms.subject?.intro, note].filter(Boolean).join('\n\n');
  for (;;) {
    const subjectForm = await showForm(screen, { title: forms.subject?.title ?? 'About you', intro: intro() || undefined, elements: withAnswers(subjectElements(forms.subject, assigned), previous) });
    const typed = String(subjectForm.values.subject_id ?? '').trim();
    if (typed !== confirmed) {
      confirmed = null;
      reused = null;
    }
    if (!assigned.overridable || remote.numberOf(typed) === assigned.n || typed === confirmed) return { subjectForm, ...(reused ? { reused } : {}) };

    if (await remote.isTaken(typed)) {
      const history = await historyOf({ remote, local }, typed);
      const choice = await askAction(screen, { message: earlier(typed, history), choices: [{ value: 'back', text: 'Go back and change it' }, { value: 'use', text: `Use ${typed} again` }] });
      if (choice === 'use') {
        // the form is shown again with the participant's details in it; the ID is now confirmed
        confirmed = typed;
        reused = { id: typed, history };
        previous = { ...subjectForm.values, ...history.subject };
        note = filledIn(typed, history);
        continue;
      }
    } else if ((await askAction(screen, { message: different(assigned.value, typed), choices: [{ value: 'back', text: 'Go back and change it' }, { value: 'use', text: `Use ${typed}` }] })) === 'use') {
      return { subjectForm, overridden: { suggested: assigned.value, used: typed } };
    }
    previous = subjectForm.values;
  }
}
