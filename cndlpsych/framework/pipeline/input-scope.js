// Several input scopes as one. A device can have more than one way to answer (a touch laptop has a
// keyboard, a mouse and a touch screen), and the experiment declares one scope per device profile:
// "press SPACE" for desktop, "tap" for tablet. When the device has the inputs of several profiles,
// any of them may answer, so their scopes are merged: the bindings of an intent add up, rules add
// up, and the gestures to recognise are all of them. Everything that is not an input (when a
// response fires, the cursor, the zone display) comes from the device's own profile.

const sameBinding = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uniqueBy = (items, same) => items.filter((item, i) => items.findIndex((other) => same(other, item)) === i);

/** "Press SPACE" + "Tap the screen" -> "Press SPACE or tap the screen". */
function joinHints(hints) {
  const distinct = [...new Set(hints.filter((hint) => typeof hint === 'string' && hint.length))];
  return distinct.map((hint, i) => (i > 0 && /^[A-Z][a-z]/.test(hint) ? `${hint[0].toLowerCase()}${hint.slice(1)}` : hint)).join(' or ');
}

function mergeIntents(scopes) {
  const names = [...new Set(scopes.flatMap((scope) => Object.keys(scope.intents ?? {})))];
  return Object.fromEntries(names.map((name) => {
    const present = scopes.map((scope) => scope.intents?.[name]).filter(Boolean);
    const hint = joinHints(present.map((intent) => intent.hint));
    return [name, { ...present[0], bindings: uniqueBy(present.flatMap((intent) => intent.bindings ?? []), sameBinding), ...(hint ? { hint } : {}) }];
  }));
}

/** The larger of two lengths like "12mm" and "14mm" when their units agree, otherwise the first. */
function largerLength(a, b) {
  const parse = (value) => /^(\d+(?:\.\d+)?)(\D+)$/.exec(String(value));
  const [pa, pb] = [parse(a), parse(b)];
  return pa && pb && pa[2] === pb[2] && Number(pb[1]) > Number(pa[1]) ? b : a;
}

/**
 * @param {object} primary the scope of the device's own profile
 * @param {object[]} [others] scopes of the other profiles whose inputs the device also has (undefined entries are skipped)
 * @returns {object} `primary` itself when there is nothing to add
 */
export function mergeScopes(primary, others = []) {
  const extra = others.filter(Boolean);
  if (!primary || !extra.length) return primary;
  const all = [primary, ...extra];
  const padding = all.map((scope) => scope.hit_padding).filter((value) => value !== undefined).reduce((best, value) => (best === undefined ? value : largerLength(best, value)), undefined);
  return {
    ...primary,
    intents: mergeIntents(all),
    rules: uniqueBy(all.flatMap((scope) => scope.rules ?? []), (a, b) => a.id === b.id),
    gestures: [...new Set(all.flatMap((scope) => scope.gestures ?? []))],
    ...(padding === undefined ? {} : { hit_padding: padding }),
  };
}
