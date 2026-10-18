import { describe, expect, it } from 'vitest';
import { compile, slugify } from './compiler.js';
import { compileVariant, exampleProject, variant } from '../../tools/project-fixture.js';

const EXPERIMENT = 'experiment.yaml';
const TIMELINE = 'timeline.yaml';
const STIMULI = 'stimuli.yaml';
const FORMS = 'forms.yaml';

// Block indices in spec/examples/timeline.yaml.
const FLASH_INTRO = 0;
const FLASH_TASK = 1;
const ODDBALL_TASK = 3;
const SEARCH = 5;
const POST_TASK = 6;

const goodTask = {
  params: { n: { type: 'integer', required: true, min: 1 } },
  requires: { intents: ['go'], profiles: ['desktop'] },
  events: ['task.done'],
};
const withTask = (state, manifest = goodTask, config = { n: 3 }) => {
  state.custom.tasks.my_task = manifest;
  state.timeline.blocks.push({ id: 'custom_block', module: 'my_task', config });
};
const phoneRules = (state) => state.timeline.blocks[SEARCH].input.profiles.phone.rules;

// [label, mutation, expected diagnostic]; path is omitted when only code + file are stable.
const INVALID = [
  ['duplicate block id', (s) => { s.timeline.blocks[FLASH_TASK].id = 'flash_intro'; }, { code: 'duplicate-block-id', file: TIMELINE, path: 'blocks[1]' }],
  ['duplicate trial name', (s) => { const t = s.timeline.blocks[FLASH_TASK].config.trials; t.push({ ...t[0] }); },
    { code: 'duplicate-trial-name', file: TIMELINE, path: 'blocks[1].config.trials[1]' }],
  ['duplicate stimulus name', (s) => { s.stimuli.stimuli.push({ ...s.stimuli.stimuli[5] }); }, { code: 'duplicate-stimulus', file: STIMULI, path: 'stimuli[9]' }],
  ['each entry without a name placeholder', (s) => { s.stimuli.stimuli[3].name = 'oddball_x'; }, { code: 'each-name-template', file: STIMULI, path: 'stimuli[3].name' }],
  ['placeholder name without each', (s) => { s.stimuli.stimuli[1].name = 'fix_{value}'; }, { code: 'each-name-template', file: STIMULI, path: 'stimuli[1].name' }],
  ['apriltag family without images', (s) => { s.experiment.overlay.apriltags.family = 'tag25h9'; }, { code: 'overlay-tag-family', file: EXPERIMENT, path: 'overlay.apriltags.family' }],
  ['apriltag id without an image', (s) => { s.experiment.overlay.apriltags.ids = [0, 1, 2, 7]; }, { code: 'overlay-tag-id', file: EXPERIMENT, path: 'overlay.apriltags.ids[3]' }],
  ['duplicate sink id', (s) => { s.experiment.triggers.sinks[1].id = 'eeg_serial'; }, { code: 'duplicate-sink-id', file: EXPERIMENT, path: 'triggers.sinks[1]' }],
  ['duplicate form id', (s) => { s.forms.forms.push({ ...s.forms.forms[0] }); }, { code: 'duplicate-form-id', file: FORMS, path: 'forms[1]' }],
  ['duplicate question name', (s) => { const q = s.forms.forms[0].questions; q.push({ ...q[0] }); }, { code: 'duplicate-question', file: FORMS, path: 'forms[0].questions[3]' }],
  ['duplicate trigger rule id', (s) => { s.experiment.triggers.rules[1].id = 'resp_correct'; }, { code: 'duplicate-rule-id', file: EXPERIMENT, path: 'triggers.rules[1]' }],
  ['duplicate input rule id', (s) => { phoneRules(s)[1].id = 'two_taps'; },
    { code: 'duplicate-rule-id', file: TIMELINE, path: 'blocks[5].input.profiles.phone.rules[1]' }],
  ['trigger rule both disabled and defined', (s) => { s.timeline.blocks[SEARCH].triggers.disable.push('search_onset'); },
    { code: 'disable-conflict', file: TIMELINE, path: 'blocks[5].triggers.disable[3]' }],
  ['input intent both disabled and defined', (s) => { s.timeline.blocks[SEARCH].input.disable = ['next']; },
    { code: 'disable-conflict', file: TIMELINE, path: 'blocks[5].input.disable[0]' }],
  ['"*" disable clashing with a concrete profile rule', (s) => {
    const profiles = s.timeline.blocks[SEARCH].input.profiles;
    profiles['*'] = { disable: ['space_done'] };
  }, { code: 'disable-conflict', file: TIMELINE, path: 'blocks[5].input.profiles["*"].disable[0]' }],
  ['removed keyboard_task module', (s) => { s.timeline.blocks[FLASH_TASK].module = 'keyboard_task'; }, { code: 'unknown-module', file: TIMELINE, path: 'blocks[1].module' }],
  ['unknown stimulus in a sequence', (s) => { s.timeline.blocks[FLASH_TASK].config.trials[0].sequence[0] = 'nope'; },
    { code: 'unknown-stimulus', file: TIMELINE, path: 'blocks[1].config.trials[0].sequence[0]' }],
  ['unknown start stimulus', (s) => { s.timeline.blocks[ODDBALL_TASK].config.trials[0].start = 'nope'; },
    { code: 'unknown-stimulus', file: TIMELINE, path: 'blocks[3].config.trials[0].start' }],
  ['unknown feedback stimulus', (s) => { s.timeline.blocks[ODDBALL_TASK].config.trials[0].feedback = { correct: 'nope' }; },
    { code: 'unknown-stimulus', file: TIMELINE, path: 'blocks[3].config.trials[0].feedback.correct' }],
  ['unknown instruction page', (s) => { s.timeline.blocks[FLASH_INTRO].config.pages[0] = 'nope'; },
    { code: 'unknown-stimulus', file: TIMELINE, path: 'blocks[0].config.pages[0]' }],
  ['trigger rule on an unknown stimulus', (s) => { s.experiment.triggers.rules.push({ id: 'x', on: 'phase.onset', where: { stimulus: 'nope' }, value: 5 }); },
    { code: 'unknown-stimulus', file: EXPERIMENT, path: 'triggers.rules[3].where.stimulus' }],
  ['correct.where on an unknown stimulus', (s) => { s.timeline.blocks[ODDBALL_TASK].config.trials[0].correct = { intent: 'go', where: { stimulus: 'nope' } }; },
    { code: 'unknown-stimulus', file: TIMELINE, path: 'blocks[3].config.trials[0].correct.where.stimulus' }],
  ['unknown stimulus type', (s) => { s.stimuli.stimuli[8].type = 'nonexistent'; }, { code: 'unknown-stimulus-type', file: STIMULI, path: 'stimuli[8].type' }],
  ['unknown factor in a template', (s) => { s.timeline.blocks[FLASH_TASK].config.trials[0].sequence[0] = 'flash_{colour}'; },
    { code: 'unknown-factor', file: TIMELINE, path: 'blocks[1].config.trials[0].sequence[0]' }],
  ['unknown factor in applies_to', (s) => {
    const config = s.timeline.blocks[FLASH_TASK].config;
    config.design = { factors: { colour: ['black'] } };
    config.trials[0].applies_to = { zzz: 'a' };
  }, { code: 'unknown-factor', file: TIMELINE, path: 'blocks[1].config.trials[0].applies_to.zzz' }],
  ['unknown factor in a constraint', (s) => {
    s.timeline.blocks[FLASH_TASK].config.design = { factors: { colour: ['black'] }, constraints: [{ max_run: { factor: 'zzz', n: 2 } }] };
  }, { code: 'unknown-factor', file: TIMELINE, path: 'blocks[1].config.design.constraints[0].max_run.factor' }],
  ['unknown form', (s) => { s.timeline.blocks[POST_TASK].config.form_id = 'nope'; }, { code: 'unknown-form', file: TIMELINE, path: 'blocks[6].config.form_id' }],
  ['show_if on a later question', (s) => { s.forms.forms[0].questions[2].show_if = { zzz: 'Yes' }; },
    { code: 'unknown-question', file: FORMS, path: 'forms[0].questions[2].show_if.zzz' }],
  ['block when on an unknown field', (s) => { s.timeline.blocks[POST_TASK].when = { 'session.nope': 'x' }; },
    { code: 'unknown-question', file: TIMELINE, path: 'blocks[6].when["session.nope"]' }],
  ['trigger rule with an unknown sink', (s) => { s.experiment.triggers.rules[0].sinks = ['nope']; }, { code: 'unknown-sink', file: EXPERIMENT, path: 'triggers.rules[0].sinks[0]' }],
  ['unknown profile in an input scope', (s) => { s.experiment.input.profiles.watch = {}; }, { code: 'unknown-profile', file: EXPERIMENT, path: 'input.profiles.watch' }],
  ['unknown profile in an intent hint', (s) => { s.experiment.input.intents.go.hint.watch = 'Tap'; }, { code: 'unknown-profile', file: EXPERIMENT, path: 'input.intents.go.hint.watch' }],
  ['unknown profile on a block', (s) => { s.timeline.blocks[SEARCH].profiles = ['watch']; }, { code: 'unknown-profile', file: TIMELINE, path: 'blocks[5].profiles[0]' }],
  ['block profile outside device.allowed', (s) => {
    s.experiment.device.allowed = ['desktop', 'phone'];
    s.timeline.blocks[SEARCH].profiles = ['tablet'];
  }, { code: 'block-profile-not-allowed', file: TIMELINE, path: 'blocks[5].profiles[0]' }],
  ['fixed profile not allowed', (s) => { s.experiment.device = { select: 'fixed', fixed: 'tablet', allowed: ['desktop'] }; },
    { code: 'device-fixed-not-allowed', file: EXPERIMENT, path: 'device.fixed' }],
  ['eye tracking profile not allowed', (s) => {
    s.experiment.device.allowed = ['desktop'];
    s.experiment.eyetracking = { enabled: true, profiles: ['phone'] };
  }, { code: 'eyetracking-profile-not-allowed', file: EXPERIMENT, path: 'eyetracking.profiles[0]' }],
  ['missing image asset', (s) => { s.stimuli.stimuli.push({ name: 'pic', type: 'image', src: 'img/x.png' }); }, { code: 'missing-asset', file: STIMULI, path: 'stimuli[9].src' }],
  ['missing consent file', (s) => { s.experiment.consent.file = 'nope.md'; }, { code: 'consent-file-missing', file: EXPERIMENT, path: 'consent.file' }],
  ['min_age with an optional age field', (s) => { s.forms.subject.overrides = { age: { required: false } }; },
    { code: 'min-age-needs-age', file: FORMS, path: 'subject.overrides.age.required' }],
  ['disable of an unknown trigger rule', (s) => { s.timeline.blocks[SEARCH].triggers.disable.push('ghost'); },
    { code: 'disable-unknown', file: TIMELINE, path: 'blocks[5].triggers.disable[3]' }],
  ['disable of an unknown input rule', (s) => { s.timeline.blocks[SEARCH].input.profiles.desktop.disable = ['ghost']; },
    { code: 'disable-unknown', file: TIMELINE, path: 'blocks[5].input.profiles.desktop.disable[0]' }],
  ['disable of an unknown intent', (s) => { s.timeline.blocks[SEARCH].input.disable = ['ghost']; },
    { code: 'disable-unknown', file: TIMELINE, path: 'blocks[5].input.disable[0]' }],
  ['input rule without emit after resolving', (s) => { phoneRules(s).push({ id: 'orphan', match: { on: 'input.tap' } }); },
    { code: 'rule-incomplete', file: TIMELINE, path: 'blocks[5]' }],
  ['trigger rule without value after resolving', (s) => { s.experiment.triggers.rules.push({ id: 'novalue', on: 'phase.onset' }); },
    { code: 'rule-incomplete', file: TIMELINE }],
  ['intent without a binding for an allowed profile', (s) => { delete s.experiment.input.intents.go.phone; },
    { code: 'uncovered-intent', file: TIMELINE, path: 'blocks[3].config.trials[0].response' }],
  ['unknown response intent', (s) => { s.timeline.blocks[ODDBALL_TASK].config.trials[0].response = 'nope'; },
    { code: 'unknown-intent', file: TIMELINE, path: 'blocks[3].config.trials[0].response' }],
  ['unknown correct intent', (s) => { s.timeline.blocks[ODDBALL_TASK].config.trials[0].correct = { intent: 'nope' }; },
    { code: 'unknown-intent', file: TIMELINE, path: 'blocks[3].config.trials[0].correct' }],
  ['rule emitting an undeclared intent', (s) => { phoneRules(s)[0].emit = { intent: 'ghost' }; }, { code: 'unknown-intent', file: TIMELINE, path: 'blocks[5]' }],
  ['hint of an undeclared intent', (s) => { s.stimuli.stimuli[0].html += '{{ghost.hint}}'; }, { code: 'unknown-intent-hint', file: STIMULI, path: 'stimuli[0].html' }],
  ['tap binding with the tap gesture disabled', (s) => { s.timeline.blocks[SEARCH].input.profiles.phone.gestures = []; },
    { code: 'gesture-not-enabled', file: TIMELINE, path: 'blocks[5]' }],
  ['trigger value above 255 on a raw sink', (s) => { s.experiment.triggers.rules[0].value = 300; }, { code: 'value-out-of-range', file: EXPERIMENT, path: 'triggers.rules[0].value' }],
  ['stimulus trigger_base above 255', (s) => { s.stimuli.stimuli[3].trigger_base = 250; }, { code: 'value-out-of-range', file: STIMULI, path: 'stimuli[3].trigger_base' }],
  ['one value for two meanings', (s) => { s.experiment.triggers.rules[1].value = 21; }, { code: 'value-collision', file: TIMELINE }],
  ['raw sink template that is not hex bytes', (s) => { s.experiment.triggers.sinks[0].template = '{value}'; },
    { code: 'bad-sink-template', file: EXPERIMENT, path: 'triggers.sinks[0].template' }],
  ['template sink with an unknown field', (s) => { s.experiment.triggers.sinks[1].format = 'template'; s.experiment.triggers.sinks[1].template = '{nope}'; delete s.experiment.triggers.sinks[1].fields; },
    { code: 'bad-sink-template', file: EXPERIMENT, path: 'triggers.sinks[1].template' }],
  ['ping sync on a serial sink', (s) => { s.experiment.triggers.sinks[0].sync = { pings: 3 }; },
    { code: 'sink-sync-unsupported', file: EXPERIMENT, path: 'triggers.sinks[0].sync' }],
  ['ack on a USB sink', (s) => {
    s.experiment.triggers.sinks.push({ id: 'usb1', type: 'usb', format: 'raw', vendor_id: 1, product_id: 2, endpoint: 1, ack: true });
  }, { code: 'sink-ack-unsupported', file: EXPERIMENT, path: 'triggers.sinks[2].ack' }],
  ['reset_after_ms on a text sink', (s) => { s.experiment.triggers.sinks[1].reset_after_ms = 5; },
    { code: 'sink-reset-needs-raw', file: EXPERIMENT, path: 'triggers.sinks[1].reset_after_ms' }],
  ['unknown trigger event', (s) => { s.experiment.triggers.rules[0].on = 'response.evalutaed'; }, { code: 'unknown-event', file: EXPERIMENT, path: 'triggers.rules[0].on' }],
  ['undeclared semantic event', (s) => { s.experiment.triggers.rules.push({ id: 'g', on: 'semantic.ghost', value: 5 }); }, { code: 'unknown-event', file: EXPERIMENT, path: 'triggers.rules[3].on' }],
  ['unknown field in where', (s) => { s.experiment.triggers.rules[0].where = { nope: true }; }, { code: 'unknown-where-key', file: EXPERIMENT, path: 'triggers.rules[0].where.nope' }],
  ['unknown event in an input rule match', (s) => { phoneRules(s)[1].match.on = 'input.tapp'; },
    { code: 'unknown-event', file: TIMELINE, path: 'blocks[5].input.profiles.phone.rules[1].match.on' }],
  ['generator param of the wrong type', (s) => { s.stimuli.stimuli[8].params.targets = 'two'; }, { code: 'bad-param', file: STIMULI, path: 'stimuli[8].params.targets' }],
  ['unknown generator param', (s) => { s.stimuli.stimuli[8].params.bogus = 1; }, { code: 'unknown-param', file: STIMULI, path: 'stimuli[8].params.bogus' }],
  ['missing required task param', (s) => withTask(s, goodTask, {}), { code: 'missing-param', file: TIMELINE, path: 'blocks[7].config.n' }],
  ['task param below its minimum', (s) => withTask(s, goodTask, { n: 0 }), { code: 'bad-param', file: TIMELINE, path: 'blocks[7].config.n' }],
  ['task that does not support a profile', (s) => withTask(s), { code: 'task-profile-unsupported', file: TIMELINE, path: 'blocks[7]' }],
  ['task requiring an undeclared intent', (s) => withTask(s, { requires: { intents: ['ghost'] } }, {}), { code: 'unknown-intent', file: TIMELINE, path: 'blocks[7].config' }],
  ['invalid task manifest', (s) => { s.custom.tasks.broken = { params: { x: { type: 'bogus' } } }; }, { code: 'manifest', file: 'custom/tasks/broken.js', path: 'params.x.type' }],
  ['stimulus without required text', (s) => { delete s.stimuli.stimuli[3].text; }, { code: 'schema', file: STIMULI, path: 'stimuli[3].text' }],
  ['trial without a sequence', (s) => { delete s.timeline.blocks[FLASH_TASK].config.trials[0].sequence; },
    { code: 'schema', file: TIMELINE, path: 'blocks[1].config.trials[0].sequence' }],
  ['experiment without consent', (s) => { delete s.experiment.consent; }, { code: 'schema', file: EXPERIMENT, path: 'consent' }],
  ['unknown key in experiment.yaml', (s) => { s.experiment.colour = 'red'; }, { code: 'schema', file: EXPERIMENT, path: 'colour' }],
  ['broken YAML', (s) => { s.raw[TIMELINE] = 'blocks: [unclosed'; }, { code: 'yaml-syntax', file: TIMELINE, path: '' }],
  ['duplicate YAML key', (s) => { s.raw[EXPERIMENT] = 'name: a\nname: b\n'; }, { code: 'yaml-syntax', file: EXPERIMENT, path: '' }],
  ['missing timeline.yaml', (s) => { s.timeline = undefined; }, { code: 'missing-file', file: TIMELINE, path: '' }],
];

describe('spec/examples', () => {
  it('compiles with zero errors', async () => {
    const result = compile(await exampleProject());
    expect(result.errors).toEqual([]);
    expect(result.plan).not.toBeNull();
  });

  it('warns only about physical units without calibration', async () => {
    const { warnings } = compile(await exampleProject());
    expect(warnings.length).toBeGreaterThan(0);
    expect(new Set(warnings.map((w) => w.code))).toEqual(new Set(['units-need-calibration']));
  });

  it('expands each: oddball_A..oddball_Ǝ with triggers 100..109', async () => {
    const { plan } = compile(await exampleProject());
    expect(plan.stimuli.oddball_A.trigger).toBe(100);
    expect(plan.stimuli['oddball_Ǝ']).toMatchObject({ text: 'Ǝ', trigger: 109 });
    expect(plan.stimuli.fixation_plus.trigger).toBe(1);
  });

  it('keeps the on key of event patterns as a string', async () => {
    const { plan } = compile(await exampleProject());
    const rule = plan.blocks[SEARCH].input.desktop.rules.find((r) => r.id === 'space_done');
    expect(Object.keys(rule.match)).toEqual(['on', 'where']);
  });

  it('adds the camera consent statement when eye tracking is enabled', async () => {
    const { plan } = await compileVariant((s) => { s.experiment.eyetracking = { enabled: true }; });
    expect(plan.consent.statements.map((st) => st.id)).toEqual(['read', 'voluntary', 'camera']);
    const off = compile(await exampleProject()).plan;
    expect(off.consent.statements.map((st) => st.id)).toEqual(['read', 'voluntary']);
  });
});

describe('firebase experiment id', () => {
  it('defaults to a slug of the experiment name, and an explicit id is kept', async () => {
    const { plan } = compile(await exampleProject());
    expect(plan.storage.firebase.experiment_id).toBe('oddball-flashes-and-visual-search');
    const named = await compileVariant((s) => { s.experiment.storage.firebase.experiment_id = 'my-study'; });
    expect(named.plan.storage.firebase.experiment_id).toBe('my-study');
  });

  it.each([
    ['Oddball, flashes!', 'oddball-flashes'],
    ['  --A  b--  ', 'a-b'],
    ['x'.repeat(60), 'x'.repeat(41)],
    ['ab-'.repeat(20), `${'ab-'.repeat(13)}ab`],
  ])('slugifies %j to a valid id', (name, expected) => {
    expect(slugify(name)).toBe(expected);
    expect(slugify(name)).toMatch(/^[a-z0-9][a-z0-9-]{1,40}$/);
  });
});

describe('invalid projects', () => {
  it('has at least 40 cases', () => {
    expect(INVALID.length).toBeGreaterThanOrEqual(40);
  });

  it.each(INVALID)('%s', async (_label, mutate, expected) => {
    const { errors, plan } = await compileVariant(mutate);
    expect(plan).toBeNull();
    const matches = errors.filter((e) => e.code === expected.code && e.file === expected.file
      && (expected.path === undefined || e.path === expected.path));
    expect(matches, JSON.stringify(errors.map(({ code, file, path }) => ({ code, file, path })))).not.toHaveLength(0);
    expect(matches[0].message.length).toBeGreaterThan(10);
  });

  it('every error code in the table is distinct enough to cover the documented checks', () => {
    const codes = new Set(INVALID.map(([, , expected]) => expected.code));
    for (const code of ['duplicate-block-id', 'unknown-stimulus', 'unknown-form', 'unknown-sink', 'uncovered-intent',
      'value-out-of-range', 'value-collision', 'unknown-event', 'unknown-where-key', 'bad-param', 'min-age-needs-age',
      'eyetracking-profile-not-allowed', 'rule-incomplete', 'disable-unknown', 'unknown-factor']) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it('points keyboard_task users at response_task', async () => {
    const { errors } = await compileVariant((s) => { s.timeline.blocks[FLASH_TASK].module = 'keyboard_task'; });
    expect(errors.find((e) => e.code === 'unknown-module').message).toContain('response_task');
  });
});

describe('webcam recording', () => {
  it('adds a consent statement that names the video (and the sound), and the camera statement of eye tracking is not added as well', async () => {
    const { plan } = await compileVariant((s) => { s.experiment.webcam = { enabled: true, audio: true }; s.experiment.eyetracking = { enabled: true }; });
    const ids = plan.consent.statements.map((st) => st.id);
    expect(ids).toEqual(['read', 'voluntary', 'webcam']);
    expect(plan.consent.statements.at(-1)).toMatchObject({ required: true, text: expect.stringContaining('video and sound of me being recorded') });
    expect(plan.webcam).toMatchObject({ enabled: true, audio: true });
  });

  it('keeps the own webcam statement of the experimenter', async () => {
    const own = { id: 'webcam', text: 'My own wording.', required: true };
    const { plan } = await compileVariant((s) => { s.experiment.webcam = { enabled: true }; s.experiment.consent.statements.push(own); });
    expect(plan.consent.statements.filter((st) => st.id === 'webcam')).toEqual([own]);
  });

  it('rejects a profile that does not exist', async () => {
    const { errors } = await compileVariant((s) => { s.experiment.webcam = { enabled: true, profiles: ['desktop', 'watch'] }; });
    expect(errors).toContainEqual(expect.objectContaining({ code: 'webcam-profile', path: 'webcam.profiles[1]' }));
  });

  it('warns that the video does not go to Firebase', async () => {
    const { warnings } = await compileVariant((s) => {
      s.experiment.webcam = { enabled: true };
      s.experiment.storage.firebase = { enabled: true, access: 'controlled', web_config: { apiKey: 'a', projectId: 'p', appId: 'x' } };
    });
    expect(warnings.map((w) => w.code)).toContain('webcam-not-uploaded');
    const quiet = await compileVariant((s) => { s.experiment.webcam = { enabled: true }; s.experiment.storage.firebase = { enabled: false }; });
    expect(quiet.warnings.map((w) => w.code)).not.toContain('webcam-not-uploaded');
  });
});

describe('warnings', () => {
  it('warns when two rules can fire on the same event, unless allow_multiple is set', async () => {
    const dup = { id: 'dup', on: 'response.evaluated', where: { correct: true }, value: 40 };
    const warned = await compileVariant((s) => { s.experiment.triggers.rules.push(dup); });
    expect(warned.plan).not.toBeNull();
    expect(warned.warnings.some((w) => w.code === 'double-fire')).toBe(true);

    const silenced = await compileVariant((s) => { s.experiment.triggers.rules.push({ ...dup, allow_multiple: true }); });
    expect(silenced.warnings.some((w) => w.code === 'double-fire')).toBe(false);
  });

  it('does not warn about units once calibration is configured', async () => {
    const { warnings } = await compileVariant((s) => { s.experiment.device.calibration = { mode: 'card' }; });
    expect(warnings).toEqual([]);
  });
});

describe('valid variations', () => {
  it('accepts a "*" binding as coverage for every profile', async () => {
    const { errors } = await compileVariant((s) => {
      const go = s.experiment.input.intents.go;
      delete go.desktop; delete go.phone; delete go.tablet;
      go['*'] = { key: ' ' };
    });
    expect(errors).toEqual([]);
  });

  it('accepts a rule that emits an intent instead of a binding', async () => {
    const { errors } = await compileVariant((s) => {
      const input = s.experiment.input;
      delete input.intents.go.desktop;
      input.profiles.desktop = { rules: [{ id: 'space_go', match: { on: 'input.key.down', where: { key: ' ' } }, emit: { intent: 'go' } }] };
    });
    expect(errors).toEqual([]);
  });

  it('accepts a custom task with a manifest, its declared events, and a trigger on them', async () => {
    const { errors, plan } = await compileVariant((s) => {
      withTask(s, { ...goodTask, requires: { intents: ['go'] } });
      s.experiment.triggers.rules.push({ id: 'custom_done', on: 'task.done', value: 60 });
    });
    expect(errors).toEqual([]);
    expect(plan.blocks[7].module).toBe('my_task');
  });

  it('uses the task manifest input as a cascade level below experiment.yaml', async () => {
    const { plan } = await compileVariant((s) => {
      withTask(s, { ...goodTask, requires: { intents: ['go'] }, input: { profiles: { '*': { fire_on: 'down' } } } });
    });
    expect(plan.blocks[7].input.desktop.fire_on).toBe('down');
  });

  it('skips a block on skip_on profiles and does not require coverage there', async () => {
    const project = await variant((s) => {
      delete s.experiment.input.intents.go.tablet;
      s.timeline.blocks[ODDBALL_TASK].skip_on = ['tablet'];
      s.timeline.blocks[FLASH_INTRO].skip_on = ['tablet'];
    });
    const { errors, plan } = compile(project);
    expect(errors).toEqual([]);
    expect(plan.blocks[ODDBALL_TASK].profiles).toEqual(['desktop', 'phone']);
  });
});
