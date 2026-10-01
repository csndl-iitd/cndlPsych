import { describe, expect, it } from 'vitest';
import { compile } from '../authoring/compiler.js';
import { createBus } from '../foundation/events.js';
import { eventProblems } from '../../tools/validators.js';
import { exampleProject } from '../../tools/project-fixture.js';
import { bindingRules, createMapping } from './mapping.js';

function setup(scope, profile = 'desktop', hooks = {}) {
  let now = 0;
  const bus = createBus({ clock: { now: () => now }, validate: eventProblems });
  const seen = [];
  bus.on('*', (event) => seen.push(event));
  const mapping = createMapping({ bus, hooks });
  mapping.setScope(scope, profile);
  return {
    bus, mapping, seen,
    semantic: () => seen.filter((e) => e.type.startsWith('semantic.')),
    input(type, data, t = (now += 10)) {
      now = t;
      const event = { type, data, t, block: null, trial: null, phase: null };
      return event;
    },
    emit(type, data, t) {
      const event = this.input(type, data, t);
      return bus.emit({ source: 'input', type, data: event.data, t: event.t });
    },
  };
}

const KEY = (key, extra = {}) => ({ key, code: key, repeat: false, trusted: true, ...extra });
const tapData = (id, role) => ({
  gesture_id: 1, pointer_type: 'touch', t_down: 0, t_up: 1, duration_ms: 1, down: { x: 0.2, y: 0.8, cx: 1, cy: 1 }, up: { x: 0.2, y: 0.8, cx: 1, cy: 1 },
  slop: 0, target: id === null ? null : { id, role }, all_trusted: true,
});
const scope = (intents = {}, rules = []) => ({ intents, rules });

describe('bindings', () => {
  it('a key binding emits semantic.<intent> with rule, profile and the time of the key', () => {
    const t = setup(scope({ go: { bindings: [{ key: ' ' }] } }));
    const raw = t.emit('input.key.down', KEY(' '), 123);
    const [event] = t.semantic();
    expect(event).toMatchObject({ type: 'semantic.go', source: 'semantic', t: 123, caused_by: raw.seq, data: { intent: 'go', rule: 'binding:go', profile: 'desktop' } });
  });

  it.each([
    ['a different key', 'x', false], ['the bound key', 'f', true],
  ])('key list: %s', (_label, key, expected) => {
    const t = setup(scope({ go: { bindings: [{ key: ['f', 'j'] }] } }));
    t.emit('input.key.down', KEY(key));
    expect(t.semantic().length > 0).toBe(expected);
  });

  it('ignores key repeats, and fires on key up when asked', () => {
    const t = setup(scope({ go: { bindings: [{ key: 'f' }] }, stop: { bindings: [{ key: 'f', on: 'up' }] } }));
    t.emit('input.key.down', KEY('f', { repeat: true }));
    expect(t.semantic()).toHaveLength(0);
    t.emit('input.key.up', KEY('f'));
    expect(t.semantic().map((e) => e.type)).toEqual(['semantic.stop']);
  });

  it('a tap binding can be restricted to a stage region or a target', () => {
    const t = setup(scope({
      left: { bindings: [{ tap: { x: [0, 0.5] } }] },
      right: { bindings: [{ tap: { x: [0.5, 1] } }] },
      hit: { bindings: [{ tap: { target: { role: 'target' } } }] },
    }), 'phone');
    t.emit('input.tap', tapData(null, null));
    t.emit('input.tap', tapData(3, 'target'));
    expect(t.semantic().map((e) => e.data.intent)).toEqual(['left', 'left', 'hit']);
  });

  it('tap with on: down uses the raw pointer press', () => {
    const t = setup(scope({ go: { bindings: [{ tap: true, on: 'down' }] } }), 'phone');
    t.emit('input.tap', tapData(null, null));
    expect(t.semantic()).toHaveLength(0);
    t.emit('input.pointer.down', { pointer_id: 1, pointer_type: 'touch', button: 0, x: 0.5, y: 0.5, cx: 5, cy: 5, target: null, trusted: true });
    expect(t.semantic().map((e) => e.data.intent)).toEqual(['go']);
  });

  it('swipe bindings match direction and minimum distance (converted to px)', () => {
    const rules = bindingRules({ flick: { bindings: [{ swipe: { direction: 'left', min_distance: 0.1 } }] } }, (length) => length * 500);
    expect(rules[0].match.where).toEqual({ direction: 'left', distance: { gte: 50 } });
    const t = setup(scope({ flick: { bindings: [{ swipe: { direction: 'left' } }] }, any_way: { bindings: [{ swipe: {} }] } }), 'phone');
    const swipe = (direction) => ({ gesture_id: 1, t_down: 0, t_up: 1, duration_ms: 1, down: { x: 0, y: 0, cx: 0, cy: 0 }, up: { x: 0, y: 0, cx: 0, cy: 0 }, dx: 0, dy: 0, distance: 99, direction, all_trusted: true });
    t.emit('input.swipe', swipe('up'));
    t.emit('input.swipe', swipe('left'));
    expect(t.semantic().map((e) => e.data.intent)).toEqual(['any_way', 'flick', 'any_way']);
  });

  it('a longpress binding fires when the press reaches the threshold', () => {
    const t = setup(scope({ hold: { bindings: [{ longpress: { min_ms: 800 } }] } }), 'phone');
    const start = (threshold) => ({ gesture_id: 1, t_down: 0, t_fire: threshold, down: { x: 0.5, y: 0.5, cx: 1, cy: 1 }, threshold_ms: threshold });
    t.emit('input.longpress.start', start(500));
    t.emit('input.longpress.start', start(900));
    expect(t.semantic()).toHaveLength(1);
  });

  it('several bindings for one intent: any of them fires it', () => {
    const t = setup(scope({ go: { bindings: [{ key: ' ' }, { tap: true }] } }));
    t.emit('input.key.down', KEY(' '));
    t.emit('input.tap', tapData(null, null));
    expect(t.mapping.ruleIds).toEqual(['binding:go#1', 'binding:go#2']);
    expect(t.semantic()).toHaveLength(2);
  });
});

describe('rules', () => {
  it('emit intents, custom events (with their source) and merge rule data', () => {
    const t = setup(scope({ next: { bindings: [] } }, [
      { id: 'a', match: { on: 'input.key.down', where: { key: 'a' } }, emit: [{ intent: 'next', data: { completion: 'self_report' } }, { event: 'semantic.miss' }, { event: 'task.found', data: { n: 1 } }] },
    ]));
    t.emit('input.key.down', KEY('a'));
    const types = t.seen.map((e) => [e.type, e.source]);
    expect(types).toEqual([['input.key.down', 'input'], ['semantic.next', 'semantic'], ['semantic.miss', 'semantic'], ['task.found', 'task']]);
    expect(t.seen[1].data).toEqual({ intent: 'next', rule: 'a', profile: 'desktop', completion: 'self_report' });
    expect(t.seen[3].data).toEqual({ rule: 'a', profile: 'desktop', n: 1 });
  });

  it('run in priority order, then definition order', () => {
    const rule = (id, priority) => ({ id, priority, match: { on: 'input.key.down' }, emit: { event: `semantic.${id}` }, consume: false });
    const t = setup(scope({}, [rule('low', 0), rule('first', 5), rule('second', 5)]));
    t.emit('input.key.down', KEY('a'));
    expect(t.semantic().map((e) => e.type)).toEqual(['semantic.first', 'semantic.second', 'semantic.low']);
  });

  it('never see semantic events, so a rule cannot trigger itself', () => {
    const t = setup(scope({}, [{ id: 'loop', match: { on: 'semantic.*' }, emit: { event: 'semantic.again' }, consume: false }]));
    t.emit('input.key.down', KEY('a'));
    expect(t.semantic()).toHaveLength(0);
  });

  it('call hooks for key, end_trial and effect emissions', () => {
    const calls = [];
    const hooks = {
      injectKey: (key, meta) => calls.push(['key', key, meta.rule, meta.origin_t]),
      endTrial: (meta) => calls.push(['end', meta.rule]),
      applyEffect: (effect, refs) => calls.push(['effect', effect.add_class, refs]),
    };
    const t = setup(scope({}, [
      { id: 'k', match: { on: 'input.key.down', where: { key: 'a' } }, emit: { key: 'Enter' } },
      { id: 'e', match: { on: 'input.key.down', where: { key: 'b' } }, emit: { end_trial: true } },
      { id: 'f', match: { on: 'input.tap' }, emit: [{ effect: { add_class: 'hit' } }, { effect: { add_class: 'all', target: 'matched_targets' } }, { effect: { add_class: 'stage', target: 'stage' } }] },
    ]), 'desktop', hooks);
    t.emit('input.key.down', KEY('a'), 50);
    t.emit('input.key.down', KEY('b'));
    t.emit('input.tap', tapData(7, 'target'));
    expect(calls).toEqual([
      ['key', 'Enter', 'k', 50], ['end', 'e'],
      ['effect', 'hit', [{ id: 7, role: 'target' }]], ['effect', 'all', [{ id: 7, role: 'target' }]], ['effect', 'stage', []],
    ]);
  });

  it('keep sequence state per rule and clear it by reset level', () => {
    const scoped = (reset) => scope({}, [{ id: 's', reset, match: { sequence: [{ on: 'input.key.down', where: { key: 'a' } }, { on: 'input.key.down', where: { key: 'b' } }] }, emit: { event: 'semantic.done' }, consume: false }]);
    for (const [reset, level, survives] of [['trial', 'trial', false], ['block', 'trial', true], ['block', 'block', false], ['session', 'block', true], ['session', 'session', false], ['never', 'session', true]]) {
      const t = setup(scoped(reset));
      t.emit('input.key.down', KEY('a'));
      t.mapping.reset(level);
      t.emit('input.key.down', KEY('b'));
      expect(t.semantic().length === 1, `${reset} reset at ${level}`).toBe(survives);
    }
  });
});

describe('consumption', () => {
  it('a bound key would be consumed; an unbound key or a consume:false rule would not', () => {
    const t = setup(scope({ go: { bindings: [{ key: ' ' }] } }, [{ id: 'quiet', consume: false, match: { on: 'input.key.down', where: { key: 'q' } }, emit: { event: 'semantic.q' } }]));
    const candidate = (key) => t.input('input.key.down', KEY(key));
    expect(t.mapping.wouldConsume(candidate(' '))).toBe(true);
    expect(t.mapping.wouldConsume(candidate('x'))).toBe(false);
    expect(t.mapping.wouldConsume(candidate('q'))).toBe(false);
  });

  it('asking does not change rule state', () => {
    const t = setup(scope({}, [{ id: 's', match: { sequence: [{ on: 'input.key.down', where: { key: 'a' } }, { on: 'input.key.down', where: { key: 'b' } }] }, emit: { event: 'semantic.done' } }]));
    t.emit('input.key.down', KEY('a'));
    expect(t.mapping.wouldConsume(t.input('input.key.down', KEY('b')))).toBe(true);
    expect(t.mapping.wouldConsume(t.input('input.key.down', KEY('b')))).toBe(true);
    t.emit('input.key.down', KEY('b'));
    expect(t.semantic()).toHaveLength(1);
  });
});

describe('the built-in "any" intent', () => {
  it('is emitted for keys and taps only while a phase accepts it, not for repeats, and even when a rule consumes the input', () => {
    const t = setup(scope({ go: { bindings: [{ key: ' ' }] } }));
    t.emit('input.key.down', KEY('a'));
    expect(t.semantic()).toHaveLength(0);
    t.mapping.setAccepted(['any']);
    t.emit('input.key.down', KEY('a'));
    t.emit('input.key.down', KEY('a', { repeat: true }));
    t.emit('input.tap', tapData(null, null));
    t.emit('input.key.down', KEY(' '));
    const any = t.semantic().filter((e) => e.data.intent === 'any');
    expect(any.map((e) => e.data.via)).toEqual(['input.key.down', 'input.tap', 'input.key.down']);
    expect(any[0].data.rule).toBe('builtin:any');
    expect(any.map((e) => e.data.consumed)).toEqual([false, false, false]);
    expect(t.semantic().map((e) => e.data.intent)).toContain('go');
  });

  it('setAccepted takes a single name or a list', () => {
    const t = setup(scope());
    t.mapping.setAccepted('any');
    t.emit('input.tap', tapData(null, null));
    expect(t.semantic()).toHaveLength(1);
    t.mapping.setAccepted(undefined);
    t.emit('input.tap', tapData(null, null));
    expect(t.semantic()).toHaveLength(1);
  });
});

describe('the visual-search example, compiled from spec/examples', () => {
  async function scopeFor(profile) {
    const { plan } = compile(await exampleProject());
    return plan.blocks.find((block) => block.id === 'visual_search').input[profile];
  }

  it('desktop: SPACE alone completes the search through rule space_done', async () => {
    const t = setup(await scopeFor('desktop'), 'desktop');
    t.emit('input.key.down', KEY(' '));
    const next = t.semantic().find((e) => e.data.intent === 'next');
    expect(next.data).toEqual({ intent: 'next', rule: 'space_done', profile: 'desktop', completion: 'self_report' });
  });

  it('phone: two taps on different targets give the same intent; a distractor tap is a miss', async () => {
    const t = setup(await scopeFor('phone'), 'phone');
    t.emit('input.tap', tapData(1, 'target'));
    t.emit('input.tap', tapData(1, 'target'));
    t.emit('input.tap', tapData(9, 'distractor'));
    expect(t.semantic().filter((e) => e.type !== 'semantic.go').map((e) => e.type)).toEqual(['semantic.miss']);
    t.emit('input.tap', tapData(2, 'target'));
    const next = t.semantic().find((e) => e.type === 'semantic.next');
    expect(next.data).toEqual({ intent: 'next', rule: 'two_taps', profile: 'phone', completion: 'verified_taps' });
    expect(next.caused_by).toBe(t.seen.filter((e) => e.type === 'input.tap').at(-1).seq);
  });

  it('phone: a trial reset forgets the first tap', async () => {
    const t = setup(await scopeFor('phone'), 'phone');
    t.emit('input.tap', tapData(1, 'target'));
    t.mapping.reset('trial');
    t.emit('input.tap', tapData(2, 'target'));
    expect(t.semantic().filter((e) => e.type === 'semantic.next')).toHaveLength(0);
  });

  it('phone and desktop bindings for go also work from the experiment scope', async () => {
    const phone = setup(await scopeFor('phone'), 'phone');
    phone.emit('input.tap', tapData(null, null));
    expect(phone.semantic().some((e) => e.data.intent === 'go')).toBe(true);
    const desktop = setup(await scopeFor('desktop'), 'desktop');
    desktop.emit('input.key.down', KEY(' '));
    expect(desktop.semantic().map((e) => e.data.intent).sort()).toEqual(['go', 'next']);
  });
});
