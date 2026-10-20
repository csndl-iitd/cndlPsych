// Trigger rules every experiment gets without writing them.
//
// Universal triggers mark what the participant physically does and what the screen does: a key
// press, a pointer or touch press, each gesture, release of key and pointer, and the photodiode patch
// changing. Their values are kept in 1 to 10, so they can be told apart from the experiment's own codes
// (stimuli, responses, conditions), which should use 11 and above.
//
// Semantic triggers mark the intents the experiment responds to (go, next, ...), at the moment the
// response is handed to jsPsych during a response window. They have their own values, from 11 up.
//
// Both are ordinary rules (id universal:<name>, semantic:<intent>) at the bottom of the trigger cascade,
// so a block or trial can change or disable them like any other rule.

/** Name -> the event it is sent for and its default value. The names are the keys of `triggers.universal`. */
export const UNIVERSAL_EVENTS = {
  key_down: { on: 'input.key.down', where: { repeat: false }, value: 1 },
  pointer_down: { on: 'input.pointer.down', value: 2 },
  tap: { on: 'input.tap', value: 3 },
  longpress: { on: 'input.longpress.start', value: 4 },
  swipe: { on: 'input.swipe', value: 5 },
  drag: { on: 'input.drag.start', value: 6 },
  key_up: { on: 'input.key.up', value: 7 },
  pointer_up: { on: 'input.pointer.up', value: 8 },
  photodiode_on: { on: 'overlay.photodiode', where: { lit: true }, value: 9 },
  photodiode_off: { on: 'overlay.photodiode', where: { lit: false }, value: 10 },
};

/** Semantic triggers count up from here. */
export const FIRST_SEMANTIC_VALUE = 11;

export const isGenerated = (rule) => /^(universal|semantic):/.test(rule.id);

/**
 * @param {false|Record<string, number|false>} [config] `triggers.universal`: false for none, or values by name (false drops one)
 * @returns {object[]} trigger rules
 */
export function universalRules(config = {}) {
  if (config === false) return [];
  return Object.entries(UNIVERSAL_EVENTS)
    .map(([name, { on, where, value }]) => ({ name, on, where, value: config[name] ?? value }))
    .filter(({ value }) => value !== false)
    .map(({ name, on, where, value }) => ({ id: `universal:${name}`, on, ...(where ? { where } : {}), value, allow_multiple: true }));
}

/**
 * @param {'auto'|false|Record<string, number>} [config] `triggers.semantic`: auto numbers every intent from 11 in name order; an object gives values by intent
 * @param {string[]} intents the intents of the experiment
 * @returns {object[]} trigger rules
 */
export function semanticRules(config = 'auto', intents = []) {
  if (config === false) return [];
  const values = config === 'auto'
    ? Object.fromEntries([...new Set(intents)].sort().map((intent, i) => [intent, FIRST_SEMANTIC_VALUE + i]))
    : config;
  return Object.entries(values).map(([intent, value]) => ({
    id: `semantic:${intent}`, on: 'bridge.key_injected', where: { intent }, value, allow_multiple: true,
  }));
}

/** Every intent named in experiment.yaml, in a block or in a trial's input. */
export function intentNames(experiment, timeline) {
  const names = new Set(Object.keys(experiment.input?.intents ?? {}));
  for (const block of timeline.blocks ?? []) {
    Object.keys(block.input?.intents ?? {}).forEach((name) => names.add(name));
    for (const trial of block.config?.trials ?? []) Object.keys(trial.input?.intents ?? {}).forEach((name) => names.add(name));
  }
  return [...names];
}
