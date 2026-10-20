// stimuli.yaml: expand `each` entries, and collect which stimuli a block refers to.

const EACH_PLACEHOLDER = /\{(value|index)\}/g;
const FACTOR_PLACEHOLDER = /\{([a-z][a-z0-9_]*)\}/g;
const MAX_TEMPLATE_CELLS = 10_000;

function substitute(node, value, index) {
  if (typeof node === 'string') {
    return node.replace(EACH_PLACEHOLDER, (_, key) => String(key === 'value' ? value : index));
  }
  if (Array.isArray(node)) return node.map((item) => substitute(item, value, index));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, substitute(item, value, index)]));
  }
  return node;
}

/**
 * Expand `each` entries into one stimulus per value; `trigger_base` becomes `trigger: base + index`.
 * @returns {{name: string, stimulus: object, path: Array<string|number>, index?: number}[]}
 */
export function expandStimuli(stimuliDoc) {
  const expanded = [];
  (stimuliDoc.stimuli ?? []).forEach((entry, i) => {
    const path = ['stimuli', i];
    if (!entry.each) {
      expanded.push({ name: entry.name, stimulus: entry, path });
      return;
    }
    const { each, trigger_base: base, ...rest } = entry;
    each.forEach((value, index) => {
      const stimulus = substitute(rest, value, index);
      if (base !== undefined) stimulus.trigger = base + index;
      expanded.push({ name: stimulus.name, stimulus, path, index });
    });
  });
  return expanded;
}

export const hasEachPlaceholder = (name) => new RegExp(EACH_PLACEHOLDER.source).test(name);

/**
 * Expand `{factor}` templates in a stimulus reference over the design's factor values.
 * @returns {{names: string[], unknownFactors: string[]}}
 */
export function expandReference(name, factors = {}) {
  const used = [...new Set([...name.matchAll(FACTOR_PLACEHOLDER)].map((match) => match[1]))];
  const unknownFactors = used.filter((factor) => !(factor in factors));
  if (used.length === 0 || unknownFactors.length) return { names: unknownFactors.length ? [] : [name], unknownFactors };

  let names = [name];
  for (const factor of used) {
    names = names.flatMap((current) => factors[factor].map((value) => current.replaceAll(`{${factor}}`, String(value))));
    if (names.length > MAX_TEMPLATE_CELLS) break;
  }
  return { names, unknownFactors };
}

function trialReferences(trial, path) {
  const refs = [];
  for (const key of ['start', 'end']) {
    if (trial[key]) refs.push({ name: trial[key], path: [...path, key] });
  }
  trial.sequence.forEach((item, i) => {
    refs.push({ name: typeof item === 'string' ? item : item.stimulus, path: [...path, 'sequence', i] });
  });
  const { feedback } = trial;
  if (typeof feedback === 'string') refs.push({ name: feedback, path: [...path, 'feedback'] });
  else if (feedback) {
    for (const [key, name] of Object.entries(feedback)) refs.push({ name, path: [...path, 'feedback', key] });
  }
  return refs;
}

function paramReferences(manifest, config, path) {
  const refs = [];
  for (const [key, decl] of Object.entries(manifest?.params ?? {})) {
    const value = config?.[key];
    if (decl.type === 'stimulus' && typeof value === 'string') refs.push({ name: value, path: [...path, key] });
    if (decl.type === 'list' && decl.items?.type === 'stimulus' && Array.isArray(value)) {
      value.forEach((name, i) => refs.push({ name, path: [...path, key, i] }));
    }
  }
  return refs;
}

/**
 * Every stimulus a block names, with its path. Names that use {factor} templates are
 * expanded; factors that do not exist are returned separately.
 * @returns {{refs: {name: string, path: Array<string|number>}[], unknownFactors: {factor: string, path: Array<string|number>}[]}}
 */
export function blockReferences(block, blockPath, taskManifest) {
  const configPath = [...blockPath, 'config'];
  let raw = [];
  if (block.module === 'response_task') {
    raw = block.config.trials.flatMap((trial, i) => trialReferences(trial, [...configPath, 'trials', i]));
  } else if (block.module === 'instructions') {
    block.config.pages.forEach((page, i) => {
      if (typeof page === 'string') raw.push({ name: page, path: [...configPath, 'pages', i] });
    });
  } else if (taskManifest) {
    raw = paramReferences(taskManifest, block.config, configPath);
  }

  const factors = block.config?.design?.factors;
  const refs = [];
  const unknownFactors = [];
  for (const { name, path } of raw) {
    const expanded = expandReference(name, factors);
    expanded.unknownFactors.forEach((factor) => unknownFactors.push({ factor, path }));
    expanded.names.forEach((expandedName) => refs.push({ name: expandedName, path }));
  }
  return { refs, unknownFactors };
}
