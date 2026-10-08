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
export const EVENT_COLUMNS = ['onset', 'duration', 'trial_type', 'block', 'trial', 'phase', 'stimulus', 'intent', 'correct', 'response_time', 'outcome', 'trigger_value', 'event_seq'];

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
  const open = { block: new Map(), trial: new Map(), phase: new Map() };
  const row = (event, fields) => ({ onset: at(event), event_seq: event.seq, ...scope(event), ...fields });
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
      case 'block.start':
        begin('block', data.block_id, event, { trial_type: 'block', block: data.block_id });
        break;
      case 'block.end':
        close('block', event.block ?? data.block_id, event, { outcome: data.reason });
        break;
      case 'trial.start':
        begin('trial', scopeKey(event), event, { trial_type: 'trial' });
        break;
      case 'trial.end':
        close('trial', scopeKey(event), event, { outcome: data.outcome });
        break;
      case 'phase.onset':
        begin('phase', scopeKey(event, data.phase), event, { trial_type: 'stimulus', stimulus: data.stimulus, trigger_value: triggerValue.get(event.seq) });
        break;
      case 'phase.offset':
        close('phase', scopeKey(event, data.phase), event);
        break;
      case 'response.evaluated': {
        const cause = bySeq.get(event.caused_by);
        rows.push(row(cause?.source === 'input' ? cause : event, {
          duration: 0, trial_type: 'response', stimulus: data.stimulus, intent: data.intent, correct: data.correct, response_time: data.rt_ms === null ? null : seconds(data.rt_ms),
        }));
        break;
      }
      case 'response.timeout':
        rows.push(row(event, { duration: 0, trial_type: 'timeout' }));
        break;
      default:
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
  duration: { Description: 'Time until the matching end event; 0 for instantaneous events; n/a when the end was never recorded.', Units: 's' },
  trial_type: { Description: 'What the row describes.', Levels: { block: 'a block of the timeline', trial: 'one trial', stimulus: 'a stimulus (phase) presentation; onset is the predicted display time', response: 'a scored response; onset is the input event that caused it', timeout: 'a response window that ran out' } },
  block: { Description: 'Block id from timeline.yaml.' },
  trial: { Description: 'Trial number within the block (1-based).' },
  phase: { Description: 'Phase name within the trial.' },
  stimulus: { Description: 'Stimulus name from stimuli.yaml.' },
  intent: { Description: 'The intent the participant responded with.' },
  correct: { Description: 'Whether the response was correct (true/false); n/a when the trial defines no correctness rule.' },
  response_time: { Description: 'Response time from the onset of the phase.', Units: 's' },
  outcome: { Description: 'How a block or trial ended (correct, incorrect, timeout, none, completed, interrupted).' },
  trigger_value: { Description: 'The trigger value sent for this event, if any.' },
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
