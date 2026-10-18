// BIDS output (https://bids-specification.readthedocs.io): sessions in, dataset files out.
// Pure and dependency free, so the browser (export on finish) and the CLI (export from
// Firestore) produce the same files from the same input: a session record plus its events.
//
// Layout: behavioural `events.tsv` per session under `sub-*/ses-*/beh/`, `participants.tsv`,
// `sessions.tsv`, and everything else (the record, the full event log, an integrity note) under
// `sourcedata/`, which BIDS does not interpret.
import { eventsJsonl } from './jsonl.js';

/** The BIDS version the files are written for (see docs/decisions.md, M8). */
export const BIDS_VERSION = '1.10.0';

const NA = 'n/a';
const ONSET_DIGITS = 4; // 0.1 ms: the clock's own resolution

const entity = (label) => label.replace(/^(sub|ses)-/, '');
export const taskLabel = (name) => name.replace(/[^A-Za-z0-9]+/g, '') || 'task';

const seconds = (ms) => Number((ms / 1000).toFixed(ONSET_DIGITS));
const cell = (value) => {
  if (value === undefined || value === null || value === '') return NA;
  return String(value).replace(/[\t\r\n]+/g, ' ');
};
const tsv = (columns, rows) => `${[columns.join('\t'), ...rows.map((row) => columns.map((column) => cell(row[column])).join('\t'))].join('\n')}\n`;

// ---- time -----------------------------------------------------------------------------
/** Wall-clock milliseconds of an event. A resumed session has several clock anchors: the latest one at or before the event applies. */
function createWallClock(events) {
  const anchors = events.filter((event) => event.type === 'session.clock_anchor');
  return (event) => {
    const anchor = anchors.findLast((candidate) => candidate.seq <= event.seq) ?? anchors[0];
    return anchor ? anchor.data.time_origin_ms + event.t : null;
  };
}

// ---- events.tsv ---------------------------------------------------------------------------
export const EVENT_COLUMNS = [
  'onset', 'duration', 'trial_type', 'event_name', 'block', 'trial', 'phase', 'stimulus', 'intent', 'correct', 'response_time', 'outcome',
  'trigger_value', 'key', 'pointer_type', 'x', 'y', 'gesture_id', 'consumed', 'event_seq',
];

/** What the participant did and what the page did to them, besides the task's own events: input event type -> event_name. */
const INPUT_NAMES = {
  'input.key.down': 'key_down',
  'input.key.up': 'key_up',
  'input.pointer.down': 'pointer_down',
  'input.pointer.up': 'pointer_up',
  'input.pointer.cancel': 'pointer_cancel',
  'input.tap': 'tap',
  'input.longpress.end': 'longpress',
  'input.swipe': 'swipe',
  'input.drag.end': 'drag',
  'input.drag.cancel': 'drag_cancel',
};
const EVENT_NAMES = [
  'session_start', 'session_resume', 'session_end', 'block_start', 'block_end', 'trial_start', 'trial_end', 'stimulus_onset', 'response', 'response_timeout',
  ...Object.values(INPUT_NAMES), 'page_visible', 'page_hidden', 'window_focus', 'window_blur',
];
const GESTURES = new Set(['input.tap', 'input.longpress.end', 'input.swipe', 'input.drag.end']);
const keyName = (key) => (key === ' ' ? 'Space' : key);

/** Where an input event happened, in the columns of events.tsv (stage coordinates, 0 to 1). */
function inputFields(event) {
  const { data } = event;
  const place = data.down ?? data;
  return {
    key: data.key === undefined ? undefined : keyName(data.key),
    pointer_type: data.pointer_type,
    x: place.x,
    y: place.y,
    gesture_id: data.gesture_id,
    consumed: data.consumed,
  };
}

const scope = (event) => ({ block: event.block, trial: event.trial, phase: event.phase });
const scopeKey = (event, ...parts) => [event.block, event.trial, ...parts].join('|');

/**
 * One row per block, trial, stimulus presentation, response and timeout. Onsets are seconds
 * from `session.start`; durations come from the matching end event when there is one.
 */
export function eventRows(events) {
  const wall = createWallClock(events);
  const start = events.find((event) => event.type === 'session.start');
  const origin = start ? wall(start) : null;
  if (origin === null) return [];
  const at = (event) => seconds(wall(event) - origin);
  const bySeq = new Map(events.map((event) => [event.seq, event]));
  const triggerValue = new Map();
  for (const event of events) if (event.type === 'trigger.sent' && !triggerValue.has(event.data.event_seq)) triggerValue.set(event.data.event_seq, event.data.value);

  const rows = [];
  const named = (event_name, trial_type) => ({ event_name, trial_type });
  const open = { block: new Map(), trial: new Map(), phase: new Map() };
  const row = (event, fields) => ({ onset: at(event), event_seq: event.seq, ...scope(event), ...fields });
  // A gesture is reported when it ends; its row starts where the finger went down.
  const inputRow = (event) => {
    const length = GESTURES.has(event.type) ? (event.data.duration_ms ?? 0) / 1000 : 0;
    return { ...row(event, { duration: Number(length.toFixed(ONSET_DIGITS)), ...named(INPUT_NAMES[event.type], 'input'), ...inputFields(event) }), onset: seconds(wall(event) - origin - length * 1000) };
  };
  const close = (kind, key, event, fields = {}) => {
    const opened = open[kind].get(key);
    if (!opened) return;
    open[kind].delete(key);
    opened.row.duration = seconds(wall(event) - wall(opened.event));
    Object.assign(opened.row, fields);
  };
  const begin = (kind, key, event, fields) => {
    const previous = open[kind].get(key);
    if (previous) previous.row.outcome ??= 'interrupted'; // started again: the first attempt never ended (a resumed session)
    const created = row(event, fields);
    rows.push(created);
    open[kind].set(key, { event, row: created });
  };

  for (const event of events) {
    const { data } = event;
    switch (event.type) {
      case 'session.start':
        rows.push(row(event, { duration: 0, ...named('session_start', 'session') }));
        break;
      case 'session.resume':
        rows.push(row(event, { duration: 0, ...named('session_resume', 'session') }));
        break;
      case 'session.end':
        rows.push(row(event, { duration: 0, outcome: data.reason, ...named('session_end', 'session') }));
        break;
      case 'block.start':
        begin('block', data.block_id, event, { ...named('block_start', 'block'), block: data.block_id });
        break;
      case 'block.end':
        close('block', event.block ?? data.block_id, event, { outcome: data.reason });
        rows.push(row(event, { duration: 0, outcome: data.reason, ...named('block_end', 'block') }));
        break;
      case 'trial.start':
        begin('trial', scopeKey(event), event, named('trial_start', 'trial'));
        break;
      case 'trial.end':
        close('trial', scopeKey(event), event, { outcome: data.outcome });
        rows.push(row(event, { duration: 0, outcome: data.outcome, response_time: data.rt_ms === null || data.rt_ms === undefined ? null : seconds(data.rt_ms), ...named('trial_end', 'trial') }));
        break;
      case 'phase.onset':
        begin('phase', scopeKey(event, data.phase), event, { ...named('stimulus_onset', 'stimulus'), stimulus: data.stimulus, trigger_value: triggerValue.get(event.seq) });
        break;
      case 'phase.offset':
        close('phase', scopeKey(event, data.phase), event);
        break;
      case 'response.evaluated': {
        const cause = bySeq.get(event.caused_by);
        rows.push(row(cause?.source === 'input' ? cause : event, {
          duration: 0, ...named('response', 'response'), stimulus: data.stimulus, intent: data.intent, correct: data.correct, response_time: data.rt_ms === null ? null : seconds(data.rt_ms),
        }));
        break;
      }
      case 'response.timeout':
        rows.push(row(event, { duration: 0, ...named('response_timeout', 'timeout') }));
        break;
      case 'page.visibility':
        rows.push(row(event, { duration: 0, ...named(`page_${data.state}`, 'page') }));
        break;
      case 'page.focus':
        rows.push(row(event, { duration: 0, ...named(data.focused ? 'window_focus' : 'window_blur', 'page') }));
        break;
      default:
        if (INPUT_NAMES[event.type]) rows.push(inputRow(event));
    }
  }
  return rows.sort((a, b) => a.onset - b.onset || a.event_seq - b.event_seq);
}

export const eventsTsv = (events) => tsv(EVENT_COLUMNS, eventRows(events));

/** The task-level sidecar: the task, the software that presented it, and the events.tsv columns. */
export const eventsJson = ({ name, frameworkVersion }) => `${JSON.stringify({
  TaskName: name,
  StimulusPresentation: { SoftwareName: 'expfw', SoftwareVersion: frameworkVersion },
  onset: { Description: 'Seconds from the start of the session (session.start), on the wall clock; a resumed session is aligned through its clock anchors.', Units: 's' },
  duration: { Description: 'Time until the matching end event (blocks, trials, stimuli) or the length of the gesture; 0 for instantaneous events; n/a when the end was never recorded.', Units: 's' },
  trial_type: {
    Description: 'What kind of event the row is.',
    Levels: {
      session: 'start, resume or end of the session',
      block: 'start or end of a block of the timeline',
      trial: 'start or end of a trial',
      stimulus: 'a stimulus (phase) presentation; onset is the predicted display time',
      response: 'a scored response; onset is the input event that caused it',
      timeout: 'a response window that ran out',
      input: 'something the participant did: a key, a pointer press or a gesture (typing in form fields is never recorded)',
      page: 'the page was hidden or shown, or the window lost or regained focus',
    },
  },
  event_name: {
    Description: `What the event is: ${EVENT_NAMES.join(', ')}. A stimulus_onset row says which stimulus (for example the fixation) in stimulus and phase. A gesture row starts where the finger went down and lasts until it lifted.`,
  },
  block: { Description: 'Block id from timeline.yaml.' },
  trial: { Description: 'Trial number within the block (1-based).' },
  phase: { Description: 'Phase name within the trial.' },
  stimulus: { Description: 'Stimulus name from stimuli.yaml.' },
  intent: { Description: 'The intent the participant responded with.' },
  correct: { Description: 'Whether the response was correct (true/false); n/a when the trial defines no correctness rule.' },
  response_time: { Description: 'Response time from the onset of the phase.', Units: 's' },
  outcome: { Description: 'How a block, trial or session ended (correct, incorrect, timeout, none, completed, complete, aborted, error, interrupted).' },
  trigger_value: { Description: 'The trigger value sent for this event, if any.' },
  key: { Description: 'The key of a key_down or key_up row (Space for the space bar).' },
  pointer_type: { Description: 'mouse, touch or pen.', Levels: { mouse: 'mouse', touch: 'finger on a touch screen', pen: 'pen' } },
  x: { Description: 'Horizontal position of a pointer or gesture row on the stage, 0 (left) to 1 (right); where a gesture started.' },
  y: { Description: 'Vertical position of a pointer or gesture row on the stage, 0 (top) to 1 (bottom); where a gesture started.' },
  gesture_id: { Description: 'Number of the press: pointer_down, pointer_up and the gesture that came of it have the same number.' },
  consumed: { Description: 'true when the key was taken by a response rule and not passed on to the page.' },
  event_seq: { Description: 'Sequence number of the source event in sourcedata events.jsonl.' },
}, null, 2)}\n`;

// ---- participants, sessions, dataset ----------------------------------------------------------
const participantColumns = (subjects) => ['participant_id', ...new Set(subjects.flatMap((subject) => Object.keys(subject.fields)))];

function participantsTsv(sessions) {
  const latest = new Map();
  for (const { record } of sessions) latest.set(record.subject_id, { id: `sub-${entity(record.subject_id)}`, fields: record.subject ?? {} });
  const subjects = [...latest.values()];
  return tsv(participantColumns(subjects), subjects.map(({ id, fields }) => ({ participant_id: id, ...fields })));
}

/** The sex values that occur, each as its own level (the form offers male and female; an experiment may offer others). */
const sexLevels = (sessions) => Object.fromEntries([...new Set(['male', 'female', ...sessions.map(({ record }) => record.subject?.sex).filter(Boolean)])].map((value) => [value, value]));

const participantsJson = (sessions) => `${JSON.stringify({
  participant_id: { Description: 'Participant identifier' },
  sex: { Description: 'Sex as answered by the participant', Levels: sexLevels(sessions) },
  age: { Description: 'Age in years (n/a when not given)', Units: 'year' },
}, null, 2)}\n`;

const acquisitionTime = (record) => new Date(record.started_at).toISOString().replace(/\.\d+Z$/, 'Z');

function sessionsTsv(forSubject) {
  return tsv(['session_id', 'acq_time'], forSubject.map(({ record }) => ({ session_id: `ses-${entity(record.session_id)}`, acq_time: acquisitionTime(record) })));
}

const datasetDescription = (name, frameworkVersion) => `${JSON.stringify({
  Name: name,
  BIDSVersion: BIDS_VERSION,
  DatasetType: 'raw',
  GeneratedBy: [{ Name: 'expfw', Version: frameworkVersion }],
}, null, 2)}\n`;

const README = (name) => `# ${name}

Behavioural data written by expfw. Each session has an \`events.tsv\` under \`beh/\`; onsets are
seconds from the start of the session. The complete event log, the session record and, when a
session is incomplete, an integrity note are under \`sourcedata/\`.
`;

/**
 * @param {{record: object, events: object[], issues?: string[]}[]} sessions `issues` are integrity problems found when reading the session back
 * @param {{prefix?: string, frameworkVersion?: string}} [options] `prefix` is prepended to every file name (a folder inside a zip)
 * @returns {{name: string, data: string}[]}
 */
export function bidsFiles(sessions, { prefix = '', frameworkVersion = sessions[0]?.record.experiment?.framework_version ?? '0.0.0' } = {}) {
  if (!sessions.length) return [];
  const { experiment } = sessions[0].record;
  const task = taskLabel(experiment.name);
  const files = [
    { name: 'dataset_description.json', data: datasetDescription(experiment.name, frameworkVersion) },
    { name: 'README', data: README(experiment.name) },
    { name: 'participants.tsv', data: participantsTsv(sessions) },
    { name: 'participants.json', data: participantsJson(sessions) },
    { name: `task-${task}_events.json`, data: eventsJson({ name: experiment.name, frameworkVersion }) },
  ];
  const bySubject = Map.groupBy(sessions, ({ record }) => entity(record.subject_id));
  for (const [subject, forSubject] of bySubject) {
    files.push({ name: `sub-${subject}/sub-${subject}_sessions.tsv`, data: sessionsTsv(forSubject) });
    for (const { record, events, issues = [] } of forSubject) {
      const session = entity(record.session_id);
      const stem = `sub-${subject}_ses-${session}`;
      const source = `sourcedata/sub-${subject}/ses-${session}`;
      files.push(
        { name: `sub-${subject}/ses-${session}/beh/${stem}_task-${task}_events.tsv`, data: eventsTsv(events) },
        { name: `${source}/session.json`, data: `${JSON.stringify(record, null, 2)}\n` },
        { name: `${source}/events.jsonl`, data: eventsJsonl(events) },
        ...(issues.length ? [{ name: `${source}/INCOMPLETE.txt`, data: `This session is incomplete:\n${issues.map((issue) => `- ${issue}`).join('\n')}\n` }] : []),
      );
    }
  }
  return files.map((file) => ({ ...file, name: `${prefix}${file.name}` }));
}
