// Input cascade, resolved at compile time for one concrete device profile:
//   framework defaults < task defaults < experiment.yaml < block < trial
// Within one level the "*" profile applies first, then the concrete profile.
// Intents merge by name (bindings and hints replace per intent), rules merge by id
// (field-wise override), `disable` removes inherited ids, `reset: true` clears all.

const SETTING_KEYS = ['gestures', 'fire_on', 'pointer_path', 'hit_padding', 'show_zones'];
const MERGED_SETTING_KEYS = ['gesture_thresholds', 'cursor'];
const INTENT_META_KEYS = ['plugin_key', 'doc'];

const asArray = (value) => (Array.isArray(value) ? value : [value]);
const pick = (byProfile, profile) => byProfile[profile] ?? byProfile['*'];

function emptyState() {
  return { intents: new Map(), rules: new Map(), settings: {} };
}

function applySettings(settings, scope) {
  for (const key of SETTING_KEYS) {
    if (scope[key] !== undefined) settings[key] = scope[key];
  }
  for (const key of MERGED_SETTING_KEYS) {
    if (scope[key] === undefined) continue;
    settings[key] = { ...settings[key] };
    for (const [name, value] of Object.entries(scope[key])) {
      settings[key][name] = value !== null && typeof value === 'object' && !Array.isArray(value)
        ? { ...settings[key][name], ...value }
        : value;
    }
  }
}

function applyIntent(state, name, definition, profile) {
  const entry = state.intents.get(name) ?? { bindings: [] };
  const { hint } = definition;
  if (typeof hint === 'string') entry.hint = hint;
  else if (hint && pick(hint, profile) !== undefined) entry.hint = pick(hint, profile);
  for (const key of INTENT_META_KEYS) {
    if (definition[key] !== undefined) entry[key] = definition[key];
  }
  const binding = pick(definition, profile);
  if (binding !== undefined) entry.bindings = asArray(binding);
  state.intents.set(name, entry);
}

function applyProfileScope(state, profileScope, level, path, disables) {
  profileScope.disable?.forEach((id, i) => {
    disables.push({ id, kind: 'rule', file: level.file, path: [...path, 'disable', i], unknown: !state.rules.delete(id) });
  });
  for (const rule of profileScope.rules ?? []) {
    state.rules.set(rule.id, { ...state.rules.get(rule.id), ...rule });
  }
  applySettings(state.settings, profileScope);
}

function applyLevel(state, level, profile, disables) {
  const scope = level.scope;
  if (!scope) return;
  if (scope.reset) Object.assign(state, emptyState());

  scope.disable?.forEach((name, i) => {
    disables.push({ id: name, kind: 'intent', file: level.file, path: [...level.path, 'disable', i], unknown: !state.intents.delete(name) });
  });
  for (const [name, definition] of Object.entries(scope.intents ?? {})) applyIntent(state, name, definition, profile);
  applySettings(state.settings, scope);
  for (const key of ['*', profile]) {
    const profileScope = scope.profiles?.[key];
    if (profileScope) applyProfileScope(state, profileScope, level, [...level.path, 'profiles', key], disables);
  }
}

/**
 * @param {{scope?: object, file: string, path: Array<string|number>}[]} levels lowest first
 * @param {string} profile
 * @returns {{resolved: object, disables: {id: string, kind: string, file: string, path: Array<string|number>, unknown: boolean}[]}}
 *   every `disable` entry that applied to this profile, flagged when it matched nothing inherited
 */
export function resolveInput(levels, profile) {
  const state = emptyState();
  const disables = [];
  for (const level of levels) applyLevel(state, level, profile, disables);
  return {
    resolved: {
      intents: Object.fromEntries(state.intents),
      rules: [...state.rules.values()],
      ...state.settings,
    },
    disables,
  };
}

/** A resolved scope written back as a single-level scope (re-resolving it changes nothing). */
export function resolvedAsScope(resolved, profile) {
  const { intents, rules, ...settings } = resolved;
  return {
    intents: Object.fromEntries(Object.entries(intents).map(([name, { bindings, hint, ...meta }]) => [
      name,
      { ...meta, ...(hint === undefined ? {} : { hint }), [profile]: bindings },
    ])),
    profiles: { [profile]: { rules, ...settings } },
  };
}
