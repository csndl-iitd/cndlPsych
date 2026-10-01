// The jsPsych bridge. A jsPsych *extension* (not a plugin): unmodified keyboard plugins
// see a synthetic KeyboardEvent when an accepted intent fires, so they work with taps and
// swipes too. jsPsych's own timing is never the source of truth: the bridge records
// jspsych.trial.start / load / end and bridge.key_injected on the bus, and the log is
// built from the bus only. `origin_t` in bridge.key_injected is the time of the real input.
//
// The extension class is made by a factory because jsPsych instantiates extensions itself
// (new Extension(jsPsych)); the factory closes over the bus.

const AUTO_KEYS = Array.from({ length: 12 }, (_, i) => `F${13 + i}`);
const KEY_CODES = Object.fromEntries(AUTO_KEYS.map((key) => [key, key]));

/**
 * Internal keys per intent: `plugin_key` when given, otherwise F13, F14, ... in name order
 * (keys no participant presses by accident).
 * @param {Record<string, {plugin_key?: string}>} intents
 * @returns {Record<string, string>}
 */
export function assignIntentKeys(intents) {
  const taken = new Set(Object.values(intents).map((intent) => intent.plugin_key).filter(Boolean));
  const free = AUTO_KEYS.filter((key) => !taken.has(key));
  const keys = {};
  for (const name of Object.keys(intents).sort()) {
    keys[name] = intents[name].plugin_key ?? free.shift();
    if (keys[name] === undefined) throw new RangeError(`too many intents without a plugin_key (at most ${AUTO_KEYS.length})`);
  }
  return keys;
}

/**
 * @param {{bus: object, doc?: Document}} options
 */
export function createBridge({ bus, doc = globalThis.document }) {
  let jsPsych = null;
  let keys = {};
  let accepted = new Set();

  function injectKey(key, { intent, origin_t: originT, caused_by: causedBy }) {
    if (!jsPsych) throw new Error('the jsPsych bridge is not initialised (add its extension to initJsPsych)');
    const display = jsPsych.getDisplayElement() ?? doc.body;
    const init = { key, code: KEY_CODES[key] ?? '', bubbles: true, cancelable: true };
    bus.emit({ source: 'bridge', type: 'bridge.key_injected', data: { key, intent, origin_t: originT }, caused_by: causedBy });
    display.dispatchEvent(new KeyboardEvent('keydown', init));
    display.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  bus.on('semantic.*', (event) => {
    const { intent, via } = event.data;
    if (!intent || !accepted.has(intent) || !(intent in keys)) return;
    // A real key already reaches a plugin that accepts any key; only a tap needs a synthetic one.
    if (intent === 'any' && via === 'input.key.down') return;
    injectKey(keys[intent], { intent, origin_t: event.t, caused_by: event.seq });
  });

  function describeTrial() {
    const trial = jsPsych.getCurrentTrial?.();
    return { index: jsPsych.getProgress().current_trial_global, plugin: trial?.type?.info?.name ?? 'unknown' };
  }

  class BridgeExtension {
    static info = { name: 'expfw-bridge', version: '0.1.0', data: {} };

    constructor(instance) {
      jsPsych = instance;
    }

    async initialize() {}

    /** params: { accepted: intent names the trial accepts } */
    on_start(params = {}) {
      accepted = new Set(params.accepted ?? []);
      bus.emit({ source: 'bridge', type: 'jspsych.trial.start', data: describeTrial() });
    }

    on_load() {
      bus.emit({ source: 'bridge', type: 'jspsych.trial.load', data: describeTrial() });
    }

    on_finish() {
      bus.emit({ source: 'bridge', type: 'jspsych.trial.end', data: describeTrial() });
      accepted = new Set();
      return {};
    }
  }

  return {
    Extension: BridgeExtension,
    /** Declare the intents of the current scope ('any' is always included); returns intent -> internal key. */
    setIntents(intents) {
      keys = assignIntentKeys({ any: {}, ...intents });
      return { ...keys };
    },
    /** Internal keys of the given intents, for a plugin's `choices` ('any' needs ALL_KEYS instead). */
    keysFor(intents) {
      return intents.filter((intent) => intent in keys).map((intent) => keys[intent]);
    },
    injectKey,
  };
}
