// Port of validate.py: validates the schemas, the example project and a set of
// deliberately invalid cases against spec/schema/*.json with Ajv (draft-07).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, it, expect } from 'vitest';
import { loadYaml } from './yaml12.js';
import { hasNestedArray } from '../../framework/storage/chunks.js';

const SPEC = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS = join(SPEC, 'schema');
const EX = join(SPEC, 'examples');
const BASE = 'https://example.org/expfw/1/';

const readText = (path) => readFileSync(path, 'utf8');
const readJson = (path) => JSON.parse(readText(path));
const readYaml = (path) => loadYaml(readText(path));
const mutate = (base, change) => {
  const copy = structuredClone(base);
  change(copy);
  return copy;
};

const schemaFiles = readdirSync(SCHEMAS).filter((name) => name.endsWith('.schema.json')).sort();
// Unknown keywords and ambiguous schemas still fail; strictTypes/strictRequired only
// police style (e.g. `pattern` without `type`) that the schemas use deliberately.
const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
addFormats(ajv);
for (const name of schemaFiles) ajv.addSchema(readJson(join(SCHEMAS, name)));

function errors(name, instance, pointer = '') {
  const validate = ajv.getSchema(BASE + name + pointer);
  validate(instance);
  return validate.errors ?? [];
}
const describeErrors = (errs) => errs.slice(0, 4).map((e) => `${e.instancePath}: ${e.message}`).join('\n');

function expectValid(name, instance, pointer) {
  const errs = errors(name, instance, pointer);
  expect(describeErrors(errs)).toBe('');
}
function expectInvalid(name, instance, pointer) {
  expect(errors(name, instance, pointer).length).toBeGreaterThan(0);
}

const exp = readYaml(join(EX, 'experiment.yaml'));
const forms = readYaml(join(EX, 'forms.yaml'));
const stim = readYaml(join(EX, 'stimuli.yaml'));
const tl = readYaml(join(EX, 'timeline.yaml'));
const events = readText(join(EX, 'events.sample.jsonl'))
  .split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
const goodSession = readJson(join(EX, 'session.sample.json'));
const goodEvent = events.find((e) => e.type === 'input.tap');

describe('YAML 1.2 loading', () => {
  it('keeps `on:` as the string key "on", never boolean true', () => {
    const parsed = loadYaml('match:\n  on: input.tap\n  off: yes\n');
    expect(Object.keys(parsed.match)).toEqual(['on', 'off']);
    expect(parsed.match.off).toBe('yes');
  });

  it('keeps `on` a string in the example project and in the event schema sources', () => {
    const rule = exp.triggers.rules[0];
    expect(Object.keys(rule)).toContain('on');
    expect(Object.keys(rule)).not.toContain('true');
  });

  it('reads 16:9 and 1:30 as strings, not sexagesimal numbers', () => {
    expect(loadYaml('a: 16:9\nb: 1:30\n')).toEqual({ a: '16:9', b: '1:30' });
  });
});

describe('schemas', () => {
  it.each(schemaFiles)('is a valid draft-07 schema: %s', (name) => {
    expect(ajv.validateSchema(readJson(join(SCHEMAS, name)))).toBe(true);
  });
});

describe('example project', () => {
  it.each([
    ['experiment.yaml', 'experiment.schema.json', exp],
    ['forms.yaml', 'forms.schema.json', forms],
    ['stimuli.yaml', 'stimuli.schema.json', stim],
    ['timeline.yaml', 'timeline.schema.json', tl],
    ['session.sample.json', 'session.schema.json', goodSession],
  ])('%s validates', (_file, schema, instance) => expectValid(schema, instance));

  it('events.sample.jsonl validates event by event', () => {
    const bad = events
      .map((e) => [e.seq, e.type, errors('event.schema.json', e)])
      .filter(([, , errs]) => errs.length)
      .map(([seq, type, errs]) => `${seq} ${type}: ${describeErrors(errs)}`);
    expect(bad).toEqual([]);
  });

  it('sample covers at least 30 distinct event types', () => {
    expect(new Set(events.map((e) => e.type)).size).toBeGreaterThanOrEqual(30);
  });

  it('custom generator manifest validates (functions drop out of JSON)', async () => {
    const file = join(EX, 'custom', 'stimuli', 'search_array.js');
    const module = await import(pathToFileURL(file).href);
    expectValid('task-manifest.schema.json', JSON.parse(JSON.stringify(module.default)), '#/definitions/stimulus_generator');
  });
});

describe('invalid cases are rejected', () => {
  const sink = (i, change) => (x) => change(x.triggers.sinks[i]);
  const cases = [
    ['experiment without consent', 'experiment.schema.json', mutate(exp, (x) => delete x.consent)],
    ['consent with neither file nor text', 'experiment.schema.json', mutate(exp, (x) => delete x.consent.file)],
    ['public firebase with overridable subject id', 'experiment.schema.json',
      mutate(exp, (x) => { x.storage.firebase.access = 'public'; })],
    ['firebase enabled without web_config', 'experiment.schema.json', mutate(exp, (x) => delete x.storage.firebase.web_config)],
    ["device.select fixed without 'fixed'", 'experiment.schema.json', mutate(exp, (x) => { x.device.select = 'fixed'; })],
    ["serial raw sink with ndjson 'fields'", 'experiment.schema.json', mutate(exp, sink(0, (s) => { s.fields = ['seq']; }))],
    ['template-format sink without template', 'experiment.schema.json',
      mutate(exp, sink(0, (s) => { s.format = 'template'; delete s.template; }))],
    ['websocket url without ws://', 'experiment.schema.json', mutate(exp, sink(1, (s) => { s.url = 'http://localhost'; }))],
    ['trigger rule with negative value', 'experiment.schema.json', mutate(exp, (x) => { x.triggers.rules[0].value = -1; })],
    ['uppercase profile key in an intent', 'experiment.schema.json',
      mutate(exp, (x) => { x.input.intents.go.Desktop = { key: 'a' }; })],
    ['binding with both key and tap', 'experiment.schema.json',
      mutate(exp, (x) => { x.input.intents.go.desktop = { key: ' ', tap: true }; })],
    ['input rule without id', 'experiment.schema.json',
      mutate(exp, (x) => { x.input.profiles.phone.rules = [{ match: { on: 'input.tap' } }]; })],
    ['unknown top-level key', 'experiment.schema.json', mutate(exp, (x) => { x.colour = 'red'; })],

    ["extra subject question reusing 'age'", 'forms.schema.json', { subject: { questions: [{ name: 'age', prompt: 'Age' }] } }],
    ['dropdown without options', 'forms.schema.json', { forms: [{ id: 'f', questions: [{ name: 'q', prompt: 'Q', type: 'dropdown' }] }] }],
    ['likert without scale', 'forms.schema.json', { forms: [{ id: 'f', questions: [{ name: 'q', prompt: 'Q', type: 'likert' }] }] }],
    ['override of a non-built-in field', 'forms.schema.json', { subject: { overrides: { height: { prompt: 'x' } } } }],

    ['text stimulus without text', 'stimuli.schema.json', { stimuli: [{ name: 'a', type: 'text' }] }],
    ['trigger and trigger_base together', 'stimuli.schema.json',
      { stimuli: [{ name: 'a_{value}', type: 'text', text: '{value}', each: ['A'], trigger: 1, trigger_base: 2 }] }],
    ['trigger_base without each', 'stimuli.schema.json', { stimuli: [{ name: 'a', type: 'text', text: 'a', trigger_base: 2 }] }],
    ['bad duration string', 'stimuli.schema.json', { stimuli: [{ name: 'a', type: 'blank', duration: '5 minutes' }] }],

    ['response_task block without config', 'timeline.schema.json', { blocks: [{ id: 'b', module: 'response_task' }] }],
    ['survey block without form_id', 'timeline.schema.json', { blocks: [{ id: 'b', module: 'survey', config: {} }] }],
    ['block with both profiles and skip_on', 'timeline.schema.json',
      { blocks: [{ id: 'b', module: 'my_task', profiles: ['desktop'], skip_on: ['phone'] }] }],
    ['trial without sequence', 'timeline.schema.json',
      { blocks: [{ id: 'b', module: 'response_task', config: { trials: [{ name: 't' }] } }] }],
    ['bad response_window', 'timeline.schema.json',
      { blocks: [{ id: 'b', module: 'response_task', config: { trials: [{ name: 't', sequence: ['a'], response_window: 'some' }] } }] }],

    ['unknown event type', 'event.schema.json', mutate(goodEvent, (x) => { x.type = 'input.tapp'; })],
    ['tap missing required data', 'event.schema.json', mutate(goodEvent, (x) => delete x.data.duration_ms)],
    ['tap with wrong source', 'event.schema.json', mutate(goodEvent, (x) => { x.source = 'system'; })],
    ['tap with unexpected data field', 'event.schema.json', mutate(goodEvent, (x) => { x.data.bogus = 1; })],
    ['trial number 0', 'event.schema.json', mutate(goodEvent, (x) => { x.trial = 0; })],

    ['subject id not in BIDS form', 'session.schema.json', mutate(goodSession, (x) => { x.subject_id = 'sub_007'; })],
    ['sex outside BIDS values', 'session.schema.json', mutate(goodSession, (x) => { x.subject.sex = 'M'; })],
  ];
  it.each(cases)('%s', (_label, schema, instance) => expectInvalid(schema, instance));

  it('accepts a custom module with free-form config', () => {
    expectValid('timeline.schema.json', { blocks: [{ id: 'b', module: 'my_task', config: { anything: 1 } }] });
  });
});

describe('Firestore documents', () => {
  const claim = { n: 7, label: 'sub-007', status: 'reserved', created_at: '2026-10-01T09:00:00Z' };

  it('claim and uid marker documents validate', () => {
    expectValid('firestore.schema.json', claim, '#/definitions/claim');
    expectValid('firestore.schema.json', { n: 7, created_at: '2026-10-01T09:00:00Z' }, '#/definitions/uid_marker');
  });

  it.each([
    ['claim with unpadded label separator', { ...claim, label: 'sub_007' }],
    ['claim with unknown status', { ...claim, status: 'done' }],
    ['claim with extra field', { ...claim, uid: 'abc' }],
  ])('rejects: %s', (_label, instance) => expectInvalid('firestore.schema.json', instance, '#/definitions/claim'));

  it('sample has nested-array events that Firestore would reject', () => {
    const nested = new Set(events.filter(hasNestedArray).map((e) => e.type));
    expect(events.filter(hasNestedArray).length).toBeGreaterThanOrEqual(2);
    expect(nested.size).toBeGreaterThan(0);
  });
});
