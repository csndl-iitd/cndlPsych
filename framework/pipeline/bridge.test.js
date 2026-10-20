import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBus } from '../foundation/events.js';
import { eventProblems } from '../../tools/validators.js';
import { assignIntentKeys, createBridge } from './bridge.js';

class FakeKeyboardEvent {
  constructor(type, init) { this.type = type; Object.assign(this, init); }
}

beforeEach(() => { globalThis.KeyboardEvent = FakeKeyboardEvent; });
afterEach(() => { delete globalThis.KeyboardEvent; });

function setup() {
  let now = 0;
  const bus = createBus({ clock: { now: () => now }, validate: eventProblems });
  const seen = [];
  bus.on('*', (event) => seen.push(event));
  const dispatched = [];
  const display = { dispatchEvent: (event) => dispatched.push([event.type, event.key, event.code]) };
  const bridge = createBridge({ bus, doc: { body: display } });
  const jsPsych = {
    getDisplayElement: () => display,
    getProgress: () => ({ current_trial_global: 4 }),
    getCurrentTrial: () => ({ type: { info: { name: 'html-keyboard-response' } } }),
  };
  const extension = new bridge.Extension(jsPsych);
  const semantic = (intent, extra = {}, t = (now += 5)) => {
    now = t;
    return bus.emit({ source: 'semantic', type: `semantic.${intent}`, data: { intent, rule: 'r', profile: 'phone', ...extra }, t, caused_by: 0 });
  };
  return { bus, seen, dispatched, bridge, extension, semantic, bridgeEvents: () => seen.filter((e) => e.source === 'bridge') };
}

describe('assignIntentKeys', () => {
  it('gives each intent an unlikely internal key in name order, and keeps plugin_key', () => {
    expect(assignIntentKeys({ stop: {}, go: {}, next: { plugin_key: 'Enter' } })).toEqual({ go: 'F13', next: 'Enter', stop: 'F14' });
  });

  it('does not hand out a key that another intent claimed', () => {
    expect(assignIntentKeys({ a: { plugin_key: 'F13' }, b: {} })).toEqual({ a: 'F13', b: 'F14' });
  });

  it('refuses more than 12 automatic keys', () => {
    const intents = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`i${String(i).padStart(2, '0')}`, {}]));
    expect(() => assignIntentKeys(intents)).toThrow(RangeError);
  });
});

describe('bridge', () => {
  it('injects the intent key as keydown and keyup into the jsPsych display, and records it with the origin time', () => {
    const t = setup();
    expect(t.bridge.setIntents({ go: {}, stop: {} })).toEqual({ any: 'F13', go: 'F14', stop: 'F15' });
    t.extension.on_start({ accepted: ['go'] });
    const cause = t.semantic('go', {}, 321);
    expect(t.dispatched).toEqual([['keydown', 'F14', 'F14'], ['keyup', 'F14', 'F14']]);
    const injected = t.seen.find((e) => e.type === 'bridge.key_injected');
    expect(injected).toMatchObject({ source: 'bridge', caused_by: cause.seq, data: { key: 'F14', intent: 'go', origin_t: 321 } });
  });

  it('only injects intents the current trial accepts, and nothing between trials', () => {
    const t = setup();
    t.bridge.setIntents({ go: {}, stop: {} });
    t.semantic('go');
    t.extension.on_start({ accepted: ['go'] });
    t.semantic('stop');
    t.extension.on_finish();
    t.semantic('go');
    expect(t.dispatched).toEqual([]);
  });

  it('injects "any" for a tap or a consumed key, but leaves an unconsumed real key to reach the plugin itself', () => {
    const t = setup();
    t.bridge.setIntents({});
    t.extension.on_start({ accepted: ['any'] });
    t.semantic('any', { via: 'input.key.down' });
    expect(t.dispatched).toEqual([]);
    t.semantic('any', { via: 'input.key.down', consumed: false });
    expect(t.dispatched).toEqual([]);
    t.semantic('any', { via: 'input.tap' });
    expect(t.dispatched.map(([type]) => type)).toEqual(['keydown', 'keyup']);
    t.semantic('any', { via: 'input.key.down', consumed: true });
    expect(t.dispatched).toHaveLength(4);
  });

  it('exposes the internal keys to put in a plugin\'s choices', () => {
    const t = setup();
    t.bridge.setIntents({ go: {}, next: { plugin_key: 'Enter' } });
    expect(t.bridge.keysFor(['go', 'next', 'none'])).toEqual(['F14', 'Enter']);
  });

  it('records jsPsych trial start, load and end on the bus, with plugin name and index', () => {
    const t = setup();
    t.extension.on_start({ accepted: [] });
    t.extension.on_load();
    expect(t.extension.on_finish()).toEqual({});
    expect(t.bridgeEvents().map((e) => [e.type, e.data])).toEqual([
      ['jspsych.trial.start', { index: 4, plugin: 'html-keyboard-response' }],
      ['jspsych.trial.load', { index: 4, plugin: 'html-keyboard-response' }],
      ['jspsych.trial.end', { index: 4, plugin: 'html-keyboard-response' }],
    ]);
  });

  it('refuses to inject before jsPsych has created the extension', () => {
    let now = 0;
    const bus = createBus({ clock: { now: () => (now += 1) } });
    const bridge = createBridge({ bus, doc: { body: {} } });
    expect(() => bridge.injectKey('F13', { intent: 'go', origin_t: 0 })).toThrow(/not initialised/);
  });

  it('declares itself as an extension, not a plugin', () => {
    const { bridge } = setup();
    expect(bridge.Extension.info.name).toBe('cndlpsych-bridge');
    expect(typeof bridge.Extension.prototype.on_start).toBe('function');
  });
});
