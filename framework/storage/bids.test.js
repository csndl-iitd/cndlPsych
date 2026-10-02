import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIDS_VERSION, bidsFiles, eventRows, eventsTsv, EVENT_COLUMNS, taskLabel } from './bids.js';

const EXAMPLES = join(import.meta.dirname, '..', '..', 'spec', 'examples');
const record = JSON.parse(readFileSync(join(EXAMPLES, 'session.sample.json'), 'utf8'));
const sample = readFileSync(join(EXAMPLES, 'events.sample.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

let seq = 0;
const ev = (type, t, data = {}, extra = {}) => ({ v: 1, seq: seq++, t, source: 'task', type, data, block: 'b', trial: null, phase: null, caused_by: null, ...extra });
const start = (origin = 1_000_000) => [
  ev('session.start', 10, {}, { block: null }),
  ev('session.clock_anchor', 11, { time_origin_ms: origin, wall_iso: 'x' }, { block: null }),
];
const fresh = () => { seq = 0; };

describe('eventRows', () => {
  it('turns a trial into block, trial, stimulus and response rows with durations from the end events', () => {
    fresh();
    const events = [
      ...start(),
      ev('block.start', 100, { block_id: 'b' }),
      ev('trial.start', 200, { trial: 1 }, { trial: 1 }),
      ev('phase.onset', 300, { phase: 'p', stimulus: 's' }, { trial: 1, phase: 'p' }),
      ev('trigger.sent', 302, { event_seq: 4, value: 7 }, { source: 'trigger' }),
      ev('phase.offset', 1300, { phase: 'p', reason: 'duration' }, { trial: 1, phase: 'p' }),
      ev('input.tap', 1200, {}, { source: 'input', trial: 1 }),
      ev('response.evaluated', 1310, { intent: 'go', correct: true, rt_ms: 900 }, { trial: 1, phase: 'p', caused_by: 7 }),
      ev('trial.end', 1400, { trial: 1, outcome: 'correct' }, { trial: 1 }),
      ev('block.end', 1500, { reason: 'complete' }),
    ];
    const rows = eventRows(events);
    expect(rows.map((row) => [row.trial_type, row.onset, row.duration])).toEqual([
      ['block', 0.09, 1.4], ['trial', 0.19, 1.2], ['stimulus', 0.29, 1], ['response', 1.19, 0],
    ]);
    expect(rows[1]).toMatchObject({ outcome: 'correct', trial: 1 });
    expect(rows[2]).toMatchObject({ stimulus: 's', trigger_value: 7 });
    expect(rows[3]).toMatchObject({ intent: 'go', correct: true, response_time: 0.9 });
  });

  it('puts the trigger value on the stimulus it was sent for, and the response at the input that caused it', () => {
    fresh();
    const events = [
      ...start(),
      ev('phase.onset', 300, { phase: 'p', stimulus: 's' }, { trial: 1, phase: 'p' }),
      ev('trigger.sent', 302, { event_seq: 2, value: 7 }, { source: 'trigger' }),
      ev('input.tap', 1200, {}, { source: 'input', trial: 1 }),
      ev('response.evaluated', 1310, { intent: 'go', correct: false, rt_ms: null }, { trial: 1, caused_by: 4 }),
    ];
    const [stimulus, response] = eventRows(events);
    expect(stimulus).toMatchObject({ trial_type: 'stimulus', stimulus: 's', trigger_value: 7 });
    expect(stimulus.duration).toBeUndefined();
    expect(response).toMatchObject({ trial_type: 'response', onset: 1.19, correct: false, response_time: null });
  });

  it('aligns events after a resume through the new clock anchor, and marks the abandoned attempt', () => {
    fresh();
    const events = [
      ...start(1_000_000),
      ev('trial.start', 5000, { trial: 3 }, { trial: 3 }),
      ev('session.clock_anchor', 50, { time_origin_ms: 1_060_000, wall_iso: 'y' }, { block: null }),
      ev('session.resume', 51, {}, { block: null }),
      ev('trial.start', 100, { trial: 3 }, { trial: 3 }),
      ev('trial.end', 900, { trial: 3, outcome: 'correct' }, { trial: 3 }),
    ];
    const rows = eventRows(events).filter((row) => row.trial_type === 'trial');
    expect(rows.map((row) => [row.onset, row.duration, row.outcome])).toEqual([[4.99, undefined, 'interrupted'], [60.09, 0.8, 'correct']]);
  });

  it('is empty without session.start, and sorted by onset', () => {
    fresh();
    expect(eventRows([ev('trial.start', 1, { trial: 1 })])).toEqual([]);
  });
});

describe('events.tsv', () => {
  it('has the BIDS required columns first, tabs, n/a for missing values, no stray whitespace', () => {
    const text = eventsTsv(sample);
    const [header, ...lines] = text.trimEnd().split('\n');
    expect(header.split('\t')).toEqual(EVENT_COLUMNS);
    expect(EVENT_COLUMNS.slice(0, 2)).toEqual(['onset', 'duration']);
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      expect(line.split('\t')).toHaveLength(EVENT_COLUMNS.length);
      expect(line).not.toMatch(/undefined|null|NaN/);
    }
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('bidsFiles', () => {
  const files = bidsFiles([{ record, events: sample }]);
  const names = files.map((file) => file.name);
  const read = (name) => files.find((file) => file.name === name).data;

  it('writes the dataset files, one events.tsv per session, and keeps the raw log in sourcedata', () => {
    expect(names).toEqual([
      'dataset_description.json', 'README', 'participants.tsv', 'participants.json', 'task-Oddballflashesandvisualsearch_events.json',
      'sub-007/sub-007_sessions.tsv', 'sub-007/ses-01/beh/sub-007_ses-01_task-Oddballflashesandvisualsearch_events.tsv',
      'sourcedata/sub-007/ses-01/session.json', 'sourcedata/sub-007/ses-01/events.jsonl',
    ]);
    expect(JSON.parse(read('sourcedata/sub-007/ses-01/session.json'))).toEqual(record);
  });

  it('describes the dataset', () => {
    expect(JSON.parse(read('dataset_description.json'))).toMatchObject({ Name: record.experiment.name, BIDSVersion: BIDS_VERSION, DatasetType: 'raw' });
    expect(read('participants.tsv')).toBe('participant_id\tsex\tage\thandedness\nsub-007\tfemale\t24\tright\n');
    expect(read('sub-007/sub-007_sessions.tsv')).toBe('session_id\tacq_time\nses-01\t2026-09-30T10:20:01Z\n');
  });

  it('describes every events.tsv column in the sidecar', () => {
    const sidecar = JSON.parse(read('task-Oddballflashesandvisualsearch_events.json'));
    expect(sidecar).toMatchObject({ TaskName: record.experiment.name, StimulusPresentation: { SoftwareName: 'expfw', SoftwareVersion: '0.1.0' } });
    expect(Object.keys(sidecar).filter((key) => EVENT_COLUMNS.includes(key))).toEqual(EVENT_COLUMNS);
  });

  it('several sessions of one subject share a participants row and a sessions.tsv', () => {
    const second = { ...record, session_id: 'ses-02', started_at: '2026-10-01T10:00:00Z' };
    const out = bidsFiles([{ record, events: sample }, { record: second, events: sample }]);
    expect(out.filter((file) => file.name === 'participants.tsv')).toHaveLength(1);
    expect(out.find((file) => file.name === 'sub-007/sub-007_sessions.tsv').data.trim().split('\n')).toHaveLength(3);
  });

  it('notes an incomplete session next to its data, and prefixes every name when asked', () => {
    const out = bidsFiles([{ record, events: sample, issues: ['chunk 2 of 5 is missing'] }], { prefix: 'bids/' });
    expect(out.every((file) => file.name.startsWith('bids/'))).toBe(true);
    expect(out.find((file) => file.name.endsWith('INCOMPLETE.txt')).data).toContain('chunk 2 of 5 is missing');
  });

  it('writes nothing for no sessions', () => {
    expect(bidsFiles([])).toEqual([]);
  });
});

describe('taskLabel', () => {
  it.each([['Oddball, flashes!', 'Oddballflashes'], ['a_b c', 'abc'], ['???', 'task']])('%j -> %s', (name, label) => {
    expect(taskLabel(name)).toBe(label);
  });
});
