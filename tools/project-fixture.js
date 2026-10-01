// Test support: load spec/examples as a compiler project and make mutated variants of it.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dump, load, CORE_SCHEMA, types } from 'js-yaml';
import { compile } from '../framework/authoring/compiler.js';
import { loadProject } from '../cli/project.js';

export const EXAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'spec', 'examples');
const SCHEMA = CORE_SCHEMA.extend({ implicit: [types.merge] });
const KEYS = { experiment: 'experiment.yaml', timeline: 'timeline.yaml', stimuli: 'stimuli.yaml', forms: 'forms.yaml' };

let cached;
export async function exampleProject() {
  cached ??= (await loadProject(EXAMPLE_DIR)).project;
  return cached;
}

/**
 * A copy of the example project after `mutate` edited its parsed documents.
 * mutate receives { experiment, timeline, stimuli, forms, custom, assets, raw } and may
 * replace `raw[file]` with text to bypass YAML serialisation (for syntax errors).
 */
export async function variant(mutate) {
  const base = await exampleProject();
  const docs = Object.fromEntries(Object.entries(KEYS).map(([key, file]) => [key, load(base.files[file], { schema: SCHEMA })]));
  const state = {
    ...docs,
    custom: structuredClone(base.custom),
    assets: [...base.assets],
    raw: {},
  };
  mutate(state);
  const files = Object.fromEntries(Object.entries(KEYS)
    .filter(([key]) => state[key] !== undefined)
    .map(([key, file]) => [file, dump(state[key], { noRefs: true })]));
  Object.assign(files, state.raw);
  for (const [file, text] of Object.entries(files)) if (text === null) delete files[file];
  return { ...base, files, custom: state.custom, assets: state.assets };
}

export async function compileVariant(mutate) {
  return compile(await variant(mutate));
}
