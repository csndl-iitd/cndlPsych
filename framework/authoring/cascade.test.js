import { describe, expect, it } from 'vitest';
import { resolveInput, resolvedAsScope } from './cascade-input.js';
import { resolveTriggers } from './cascade-triggers.js';
import { compile } from './compiler.js';
import { exampleProject } from '../../tools/project-fixture.js';

const level = (scope, name = 'level') => ({ scope, file: `${name}.yaml`, path: [name] });
const resolve = (scopes, profile = 'desktop') => resolveInput(scopes.map((scope, i) => level(scope, `l${i}`)), profile);

describe('input cascade', () => {
  it('lets a higher level replace an intent binding for one profile and keep the others', () => {
    const base = { intents: { go: { desktop: { key: ' ' }, phone: { tap: true } } } };
    const block = { intents: { go: { phone: { tap: { x: [0, 0.5] } } } } };
    expect(resolve([base, block], 'phone').resolved.intents.go.bindings).toEqual([{ tap: { x: [0, 0.5] } }]);
    expect(resolve([base, block], 'desktop').resolved.intents.go.bindings).toEqual([{ key: ' ' }]);
  });

  it('applies "*" before the concrete profile within a level, and normalises a binding list', () => {
    const scope = { intents: { go: { '*': { key: 'a' }, desktop: [{ key: 'b' }, { key: 'c' }] } } };
    expect(resolve([scope], 'desktop').resolved.intents.go.bindings).toEqual([{ key: 'b' }, { key: 'c' }]);
    expect(resolve([scope], 'phone').resolved.intents.go.bindings).toEqual([{ key: 'a' }]);
  });

  it('resolves hints per profile, with "*" and plain strings as fallbacks', () => {
    const scope = { intents: { go: { hint: { desktop: 'SPACE', '*': 'Tap' } }, stop: { hint: 'Wait' } } };
    expect(resolve([scope], 'desktop').resolved.intents.go.hint).toBe('SPACE');
    expect(resolve([scope], 'phone').resolved.intents.go.hint).toBe('Tap');
    expect(resolve([scope], 'phone').resolved.intents.stop.hint).toBe('Wait');
  });

  it('merges rules by id field-wise and appends new ids in order', () => {
    const base = { profiles: { phone: { rules: [
      { id: 'a', match: { on: 'input.tap' }, emit: { intent: 'x' }, priority: 1 },
      { id: 'b', match: { on: 'input.swipe' }, emit: { intent: 'y' } },
    ] } } };
    const block = { profiles: { phone: { rules: [{ id: 'a', priority: 5 }, { id: 'c', match: { on: 'input.tap' }, emit: { intent: 'z' } }] } } };
    const { rules } = resolve([base, block], 'phone').resolved;
    expect(rules.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(rules[0]).toEqual({ id: 'a', match: { on: 'input.tap' }, emit: { intent: 'x' }, priority: 5 });
  });

  it('removes disabled rules, and reports a disable that matches nothing', () => {
    const base = { profiles: { '*': { rules: [{ id: 'a', match: { on: 'input.tap' }, emit: { intent: 'x' } }] } } };
    const block = { profiles: { phone: { disable: ['a', 'ghost'] } } };
    const { resolved, disables } = resolve([base, block], 'phone');
    expect(resolved.rules).toEqual([]);
    expect(disables.map((d) => [d.id, d.unknown])).toEqual([['a', false], ['ghost', true]]);
  });

  it('a disable under one profile does not apply to the others', () => {
    const base = { profiles: { '*': { rules: [{ id: 'a', match: { on: 'input.tap' }, emit: { intent: 'x' } }] } } };
    const block = { profiles: { phone: { disable: ['a'] } } };
    expect(resolve([base, block], 'desktop').resolved.rules.map((r) => r.id)).toEqual(['a']);
    expect(resolve([base, block], 'desktop').disables).toEqual([]);
  });

  it('reset discards everything inherited, including intents and settings', () => {
    const base = { intents: { go: { desktop: { key: ' ' } } }, profiles: { '*': { fire_on: 'down', rules: [{ id: 'a' }] } } };
    const { resolved } = resolve([base, { reset: true, intents: { other: { desktop: { key: 'q' } } } }]);
    expect(Object.keys(resolved.intents)).toEqual(['other']);
    expect(resolved.rules).toEqual([]);
    expect(resolved.fire_on).toBeUndefined();
  });

  it('removes inherited intents with a top-level disable', () => {
    const base = { intents: { go: { desktop: { key: ' ' } }, stop: { desktop: { key: 's' } } } };
    expect(Object.keys(resolve([base, { disable: ['stop'] }]).resolved.intents)).toEqual(['go']);
  });

  it('merges gesture thresholds and cursor settings one level deep', () => {
    const base = { profiles: { '*': { gesture_thresholds: { tap: { slop: 0.02, max_duration: 300 } }, cursor: { autohide_ms: 1000 } } } };
    const block = { gesture_thresholds: { tap: { slop: 0.05 } }, cursor: { show_on_move_px: 8 } };
    const { resolved } = resolve([base, block]);
    expect(resolved.gesture_thresholds.tap).toEqual({ slop: 0.05, max_duration: 300 });
    expect(resolved.cursor).toEqual({ autohide_ms: 1000, show_on_move_px: 8 });
  });

  it('lets a later level override an earlier level whatever its profile specificity', () => {
    const base = { intents: { go: { desktop: { key: 'a' } } } };
    const block = { intents: { go: { '*': { key: 'b' } } } };
    expect(resolve([base, block]).resolved.intents.go.bindings).toEqual([{ key: 'b' }]);
  });
});

describe('trigger cascade', () => {
  const resolveT = (scopes) => resolveTriggers(scopes.map((scope, i) => level(scope, `t${i}`)));

  it('merges by id, with the inherited position kept', () => {
    const { resolved } = resolveT([
      { rules: [{ id: 'a', on: 'phase.onset', value: 1 }, { id: 'b', on: 'phase.offset', value: 2 }] },
      { rules: [{ id: 'a', value: 9 }, { id: 'c', on: 'trial.start', value: 3 }] },
    ]);
    expect(resolved.rules).toEqual([
      { id: 'a', on: 'phase.onset', value: 9 },
      { id: 'b', on: 'phase.offset', value: 2 },
      { id: 'c', on: 'trial.start', value: 3 },
    ]);
  });

  it('supports disable, reset and enabled', () => {
    const base = { rules: [{ id: 'a', on: 'phase.onset', value: 1 }] };
    expect(resolveT([base, { disable: ['a'] }]).resolved.rules).toEqual([]);
    expect(resolveT([base, { disable: ['ghost'] }]).unknownDisables.map((d) => d.id)).toEqual(['ghost']);
    expect(resolveT([base, { reset: true }]).resolved.rules).toEqual([]);
    expect(resolveT([base, { enabled: false }]).resolved.enabled).toBe(false);
    expect(resolveT([{ enabled: false }, { reset: true }]).resolved.enabled).toBe(true);
  });
});

// A small seeded generator (mulberry32): deterministic property tests without a new dependency.
function seeded(seed) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (n) => Math.floor(next() * n), pick: (items) => items[Math.floor(next() * items.length)], chance: (p) => next() < p };
}

const PROFILES = ['desktop', 'phone'];
const INTENTS = ['go', 'next', 'stop'];
const RULE_IDS = ['r1', 'r2', 'r3', 'r4'];
const BINDINGS = [{ key: ' ' }, { key: 'f' }, { tap: true }, { swipe: { direction: 'left' } }];

function randomRule(rng) {
  const rule = { id: rng.pick(RULE_IDS) };
  if (rng.chance(0.7)) rule.match = { on: rng.pick(['input.tap', 'input.key.down']) };
  if (rng.chance(0.7)) rule.emit = { intent: rng.pick(INTENTS) };
  if (rng.chance(0.3)) rule.priority = rng.int(5);
  return rule;
}

function randomProfileScope(rng) {
  const scope = {};
  if (rng.chance(0.6)) scope.rules = Array.from({ length: rng.int(3) }, () => randomRule(rng));
  const free = RULE_IDS.filter((id) => !(scope.rules ?? []).some((rule) => rule.id === id));
  if (rng.chance(0.3)) scope.disable = [rng.pick(free)];
  if (rng.chance(0.4)) scope.fire_on = rng.pick(['down', 'up']);
  if (rng.chance(0.3)) scope.cursor = { autohide_ms: rng.int(2000) };
  if (rng.chance(0.3)) scope.gesture_thresholds = { tap: { slop: rng.next() } };
  return scope;
}

function randomScope(rng) {
  const scope = {};
  if (rng.chance(0.15)) scope.reset = true;
  scope.intents = {};
  for (const intent of INTENTS.filter(() => rng.chance(0.5))) {
    scope.intents[intent] = {};
    for (const key of [...PROFILES, '*'].filter(() => rng.chance(0.4))) {
      scope.intents[intent][key] = rng.chance(0.3) ? [rng.pick(BINDINGS), rng.pick(BINDINGS)] : rng.pick(BINDINGS);
    }
    if (rng.chance(0.4)) scope.intents[intent].hint = rng.chance(0.5) ? 'hint' : { '*': 'any hint', desktop: 'desktop hint' };
  }
  const free = INTENTS.filter((intent) => !(intent in scope.intents));
  if (free.length && rng.chance(0.2)) scope.disable = [rng.pick(free)];
  scope.profiles = {};
  for (const key of [...PROFILES, '*'].filter(() => rng.chance(0.5))) scope.profiles[key] = randomProfileScope(rng);
  // A "*" disable must not clash with rules any profile of this level defines (see disable-conflict).
  const defined = Object.values(scope.profiles).flatMap((p) => (p.rules ?? []).map((rule) => rule.id));
  const wildcard = scope.profiles['*'];
  if (wildcard?.disable) wildcard.disable = wildcard.disable.filter((id) => !defined.includes(id));
  return scope;
}

const randomLevels = (rng) => Array.from({ length: 1 + rng.int(4) }, () => randomScope(rng));

describe('input resolution properties (300 random cascades each)', () => {
  const cases = Array.from({ length: 300 }, (_, i) => ({ rng: seeded(i + 1), profile: PROFILES[i % 2] }));

  it('is idempotent: re-resolving a resolved scope changes nothing', () => {
    for (const { rng, profile } of cases) {
      const { resolved } = resolve(randomLevels(rng), profile);
      const again = resolve([resolvedAsScope(resolved, profile)], profile).resolved;
      expect(again).toEqual(resolved);
    }
  });

  it('applying the same level twice equals applying it once', () => {
    for (const { rng, profile } of cases) {
      const scopes = randomLevels(rng);
      const doubled = scopes.flatMap((scope) => [scope, scope]);
      expect(resolve(doubled, profile).resolved).toEqual(resolve(scopes, profile).resolved);
    }
  });

  it('never mutates its inputs', () => {
    for (const { rng, profile } of cases.slice(0, 50)) {
      const scopes = randomLevels(rng);
      const copy = structuredClone(scopes);
      resolve(scopes, profile);
      expect(scopes).toEqual(copy);
    }
  });
});

describe('trigger resolution properties', () => {
  it('applying the same level twice equals applying it once', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rng = seeded(seed);
      const levels = Array.from({ length: 1 + rng.int(4) }, () => {
        const rules = Array.from({ length: rng.int(3) }, () => ({ id: rng.pick(RULE_IDS), ...(rng.chance(0.6) ? { on: 'phase.onset' } : {}), ...(rng.chance(0.6) ? { value: rng.int(255) } : {}) }));
        const free = RULE_IDS.filter((id) => !rules.some((rule) => rule.id === id));
        return {
          ...(rng.chance(0.15) ? { reset: true } : {}),
          ...(rng.chance(0.2) ? { enabled: rng.chance(0.5) } : {}),
          ...(rng.chance(0.3) ? { disable: [rng.pick(free)] } : {}),
          rules,
        };
      });
      const once = resolveTriggers(levels.map((scope) => level(scope))).resolved;
      const twice = resolveTriggers(levels.flatMap((scope) => [level(scope), level(scope)])).resolved;
      expect(twice).toEqual(once);
    }
  });
});

describe('golden: the visual-search block', () => {
  it.each(['desktop', 'phone', 'tablet'])('resolves input and triggers on %s', async (profile) => {
    const { plan } = compile(await exampleProject());
    const block = plan.blocks.find((b) => b.id === 'visual_search');
    const snapshot = { profile, input: block.input[profile], triggers: block.triggers };
    await expect(`${JSON.stringify(snapshot, null, 2)}\n`).toMatchFileSnapshot(`./golden/visual_search.${profile}.json`);
  });

  it('applies the touch override (hit padding, two-tap rule) and the stim:fixation_plus override', async () => {
    const { plan } = compile(await exampleProject());
    const block = plan.blocks.find((b) => b.id === 'visual_search');
    expect(block.input.phone.hit_padding).toBe('14mm');
    expect(block.input.phone.rules.map((r) => r.id)).toEqual(['two_taps', 'distractor_tap']);
    expect(block.input.desktop.rules.map((r) => r.id)).toEqual(['space_done']);
    expect(block.input.desktop.hit_padding).toBeUndefined();
    const fixation = block.triggers.rules.find((r) => r.id === 'stim:fixation_plus');
    expect(fixation).toEqual({ id: 'stim:fixation_plus', on: 'phase.onset', where: { stimulus: 'fixation_plus' }, value: 30 });
    expect(block.triggers.rules.map((r) => r.id)).not.toContain('resp_correct');
  });

  it('keeps the experiment-level response rules and the original fixation trigger in the oddball block', async () => {
    const { plan } = compile(await exampleProject());
    const oddball = plan.blocks.find((b) => b.id === 'oddball_task');
    expect(oddball.triggers.rules.find((r) => r.id === 'stim:fixation_plus').value).toBe(1);
    expect(oddball.triggers.rules.map((r) => r.id)).toEqual(expect.arrayContaining(['resp_correct', 'resp_incorrect', 'resp_timeout']));
  });

  it('resolves every trial of a response_task block', async () => {
    const { plan } = compile(await exampleProject());
    const search = plan.blocks.find((b) => b.id === 'visual_search');
    expect(search.trials).toHaveLength(1);
    expect(search.trials[0].input.phone.rules).toHaveLength(2);
    expect(search.trials[0]).not.toHaveProperty('triggers.sinks');
  });
});
