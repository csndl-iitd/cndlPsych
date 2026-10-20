// Trigger cascade: inline stimulus triggers (stim:<name>) < experiment.yaml < block < trial.
// Same merge rules as input: rules merge by id, `disable` removes inherited ids,
// `reset: true` clears everything inherited. Sinks are session-wide and not cascaded.

/**
 * @param {{scope?: object, file: string, path: Array<string|number>}[]} levels lowest first
 * @returns {{resolved: {enabled: boolean, rules: object[]}, unknownDisables: object[]}}
 */
export function resolveTriggers(levels) {
  let enabled = true;
  let rules = new Map();
  const unknownDisables = [];

  for (const { scope, file, path } of levels) {
    if (!scope) continue;
    if (scope.reset) {
      enabled = true;
      rules = new Map();
    }
    if (scope.enabled !== undefined) enabled = scope.enabled;
    scope.disable?.forEach((id, i) => {
      if (!rules.delete(id)) unknownDisables.push({ id, kind: 'trigger rule', file, path: [...path, 'disable', i] });
    });
    for (const rule of scope.rules ?? []) rules.set(rule.id, { ...rules.get(rule.id), ...rule });
  }
  return { resolved: { enabled, rules: [...rules.values()] }, unknownDisables };
}
