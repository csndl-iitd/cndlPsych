import { describe, expect, it } from 'vitest';
import { compileVariant, exampleProject, variant } from '../../tools/project-fixture.js';
import { compile } from './compiler.js';
import { intentNames, semanticRules, UNIVERSAL_EVENTS, universalRules } from './universal-triggers.js';

describe('universalRules', () => {
  it('has a rule for every physical event, each with its own value from 1 to 10', () => {
    const rules = universalRules();
    expect(rules.map((rule) => rule.id)).toEqual(Object.keys(UNIVERSAL_EVENTS).map((name) => `universal:${name}`));
    const values = rules.map((rule) => rule.value);
    expect([...values].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rules.every((rule) => rule.allow_multiple === true)).toBe(true);
  });

  it('covers key presses, pointer and touch presses, gestures and the photodiode', () => {
    const byId = Object.fromEntries(universalRules().map((rule) => [rule.id, rule]));
    expect(byId['universal:key_down']).toMatchObject({ on: 'input.key.down', where: { repeat: false }, value: 1 });
    expect(byId['universal:pointer_down']).toMatchObject({ on: 'input.pointer.down', value: 2 });
    expect(['universal:tap', 'universal:longpress', 'universal:swipe', 'universal:drag'].map((id) => byId[id].on)).toEqual(['input.tap', 'input.longpress.start', 'input.swipe', 'input.drag.start']);
    expect(byId['universal:photodiode_on']).toMatchObject({ on: 'overlay.photodiode', where: { lit: true }, value: 9 });
    expect(byId['universal:photodiode_off']).toMatchObject({ on: 'overlay.photodiode', where: { lit: false }, value: 10 });
  });

  it('takes other values by name, drops one with false, and none at all with false', () => {
    const rules = universalRules({ key_down: 4, tap: false });
    expect(rules.find((rule) => rule.id === 'universal:key_down').value).toBe(4);
    expect(rules.some((rule) => rule.id === 'universal:tap')).toBe(false);
    expect(universalRules(false)).toEqual([]);
  });
});

describe('semanticRules', () => {
  it('auto: one value per intent from 11, in name order, sent when the intent reaches the response window', () => {
    expect(semanticRules('auto', ['next', 'go', 'go'])).toEqual([
      { id: 'semantic:go', on: 'bridge.key_injected', where: { intent: 'go' }, value: 11, allow_multiple: true },
      { id: 'semantic:next', on: 'bridge.key_injected', where: { intent: 'next' }, value: 12, allow_multiple: true },
    ]);
  });

  it('takes the values given, and none with false', () => {
    expect(semanticRules({ go: 20 }, ['go', 'next']).map((rule) => [rule.id, rule.value])).toEqual([['semantic:go', 20]]);
    expect(semanticRules(false, ['go'])).toEqual([]);
  });

  it('finds the intents of the experiment, the blocks and the trials', () => {
    const experiment = { input: { intents: { go: {} } } };
    const timeline = { blocks: [{ input: { intents: { next: {} } } }, { config: { trials: [{ input: { intents: { skip: {} } } }] } }] };
    expect(intentNames(experiment, timeline).sort()).toEqual(['go', 'next', 'skip']);
  });
});

describe('in a compiled experiment', () => {
  const rulesOf = (plan, blockId) => plan.blocks.find((block) => block.id === blockId).triggers.rules;

  it('every block gets the universal rules and a semantic rule per intent, below the experiment\'s own rules', async () => {
    const { plan } = await compileVariant((state) => { delete state.experiment.triggers.universal; delete state.experiment.triggers.semantic; });
    const rules = rulesOf(plan, 'flash_task');
    expect(rules.filter((rule) => rule.id.startsWith('universal:'))).toHaveLength(10);
    expect(rules.filter((rule) => rule.id.startsWith('semantic:')).map((rule) => [rule.id, rule.value])).toEqual([['semantic:go', 11], ['semantic:next', 12]]);
    expect(rules.some((rule) => rule.id === 'resp_correct')).toBe(true);
  });

  it('can be switched off in experiment.yaml, changed there, and disabled in a block by id', async () => {
    const off = await compileVariant((state) => { state.experiment.triggers.universal = false; state.experiment.triggers.semantic = false; });
    expect(rulesOf(off.plan, 'flash_task').some((rule) => /^(universal|semantic):/.test(rule.id))).toBe(false);

    const changed = await compileVariant((state) => { state.experiment.triggers.universal = { key_down: 5, swipe: false, tap: false }; state.experiment.triggers.semantic = { go: 40 }; });
    expect(changed.errors).toEqual([]);
    const rules = rulesOf(changed.plan, 'flash_task');
    expect(rules.find((rule) => rule.id === 'universal:key_down').value).toBe(5);
    expect(rules.some((rule) => rule.id === 'universal:tap')).toBe(false);
    expect(rules.find((rule) => rule.id === 'semantic:go').value).toBe(40);
    expect(rules.some((rule) => rule.id === 'semantic:next')).toBe(false);

    const blockOff = await compileVariant((state) => {
      delete state.experiment.triggers.universal;
      state.timeline.blocks[1].triggers = { disable: ['universal:key_up', 'universal:pointer_up'] };
    });
    expect(blockOff.errors).toEqual([]);
    expect(rulesOf(blockOff.plan, 'flash_task').some((rule) => rule.id === 'universal:key_up')).toBe(false);
    expect(rulesOf(blockOff.plan, 'oddball_task').some((rule) => rule.id === 'universal:key_up')).toBe(true);
  });

  it('warns when an experiment trigger uses a value the universal triggers have (1 to 10), or a semantic one, and does not call it an error', async () => {
    const { plan, warnings, errors } = await compileVariant((state) => {
      delete state.experiment.triggers.universal;
      delete state.experiment.triggers.semantic;
    });
    expect(plan).not.toBeNull();
    expect(errors).toEqual([]);
    const reserved = warnings.filter((warning) => warning.code === 'trigger-value-reserved');
    expect(reserved.length).toBeGreaterThan(0);
    expect(reserved[0].message).toMatch(/built-in rule "(universal|semantic):/);
  });

  it('refuses two universal events with the same value', async () => {
    const { plan, errors } = await compileVariant((state) => { state.experiment.triggers.universal = { key_down: 5 }; });
    expect(plan).toBeNull();
    expect(errors.map((error) => error.code)).toContain('value-collision');
  });

  it('refuses a universal value outside 1 to 10 and a semantic value below 11', async () => {
    const universal = await compileVariant((state) => { state.experiment.triggers.universal = { key_down: 12 }; });
    expect(universal.plan).toBeNull();
    const semantic = await compileVariant((state) => { state.experiment.triggers.semantic = { go: 5 }; });
    expect(semantic.plan).toBeNull();
  });

  it('the spec example keeps its own codes and compiles without the built-in ones', async () => {
    const { plan } = compile(await exampleProject());
    expect(variant).toBeTypeOf('function');
    expect(rulesOf(plan, 'flash_task').some((rule) => /^(universal|semantic):/.test(rule.id))).toBe(false);
  });
});
