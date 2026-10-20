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
    expect(rows.map((row) => [row.event_name, row.onset, row.duration])).toEqual([
      ['session_start', 0, 0], ['block_start', 0.09, 1.4], ['trial_start', 0.19, 1.2], ['stimulus_onset', 0.29, 1], ['tap', 1.19, 0], ['response', 1.19, 0],
      ['trial_end', 1.39, 0], ['block_end', 1.49, 0],
    ]);
    const byName = (name) => rows.find((row) => row.event_name === name);
    expect(byName('trial_start')).toMatchObject({ trial_type: 'trial', outcome: 'correct', trial: 1 });
    expect(byName('stimulus_onset')).toMatchObject({ trial_type: 'stimulus', stimulus: 's', trigger_value: 7 });
    expect(byName('response')).toMatchObject({ trial_type: 'response', intent: 'go', correct: true, response_time: 0.9 });
    expect(byName('trial_end')).toMatchObject({ outcome: 'correct' });
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
    const rows = eventRows(events);
    const stimulus = rows.find((row) => row.event_name === 'stimulus_onset');
    const response = rows.find((row) => row.event_name === 'response');
    expect(stimulus).toMatchObject({ trial_type: 'stimulus', stimulus: 's', trigger_value: 7 });
    expect(stimulus.duration).toBeUndefined();
    expect(response).toMatchObject({ trial_type: 'response', onset: 1.19, correct: false, response_time: null });
  });

  it('has a row for every key press, pointer press and gesture, named, with the key or the place, and a gesture starting where it began', () => {
    fresh();
    const input = (type, t, data) => ev(type, t, data, { source: 'input', trial: 1, phase: 'p' });
    const down = { x: 0.25, y: 0.5, cx: 10, cy: 20 };
    const rows = eventRows([
      ...start(),
      input('input.key.down', 1000, { key: ' ', code: 'Space', repeat: false, trusted: true, consumed: true }),
      input('input.key.up', 1100, { key: 'a', code: 'KeyA', repeat: false, trusted: true }),
      input('input.pointer.down', 2000, { pointer_id: 1, pointer_type: 'touch', button: 0, ...down, trusted: true }),
      input('input.drag.start', 2100, { gesture_id: 4, down }),
      input('input.pointer.up', 2600, { pointer_id: 1, pointer_type: 'touch', button: 0, x: 0.75, y: 0.5, trusted: true }),
      input('input.drag.end', 2600, { gesture_id: 4, duration_ms: 600, down, up: { x: 0.75, y: 0.5 } }),
      ev('page.visibility', 3000, { state: 'hidden' }, { source: 'system' }),
      ev('page.focus', 3100, { focused: false }, { source: 'system' }),
    ]).filter((row) => row.trial_type !== 'session');
    expect(rows.map((row) => [row.event_name, row.onset, row.duration])).toEqual([
      ['key_down', 0.99, 0], ['key_up', 1.09, 0], ['pointer_down', 1.99, 0], ['drag', 1.99, 0.6], ['pointer_up', 2.59, 0], ['page_hidden', 2.99, 0], ['window_blur', 3.09, 0],
    ]);
    expect(rows[0]).toMatchObject({ trial_type: 'input', key: 'Space', consumed: true, trial: 1 });
    expect(rows[1].key).toBe('a');
    expect(rows[2]).toMatchObject({ pointer_type: 'touch', x: 0.25, y: 0.5 });
    expect(rows[3]).toMatchObject({ x: 0.25, y: 0.5, gesture_id: 4 });
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
    const rows = eventRows(events).filter((row) => row.event_name === 'trial_start');
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
    expect(sidecar).toMatchObject({ TaskName: record.experiment.name, StimulusPresentation: { SoftwareName: 'cndlpsych', SoftwareVersion: '0.1.0' } });
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
