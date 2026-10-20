// Load a project from a URL (the folder next to index.html), compile it, and discover the
// custom stimulus generators it uses. Works in the browser; the same compile() runs in
// `cli validate`.
import { dump } from 'js-yaml';
import { compile } from '../authoring/compiler.js';
import { parseYaml } from '../authoring/spec.js';
import { hashText } from '../foundation/session.js';

const FILES = ['experiment.yaml', 'forms.yaml', 'stimuli.yaml', 'timeline.yaml'];
const BUILTIN_STIMULUS_TYPES = ['html', 'text', 'image', 'audio', 'shape', 'fill', 'blank'];

async function fetchText(url, { optional = false } = {}) {
  const response = await fetch(url);
  if (response.ok) return response.text();
  if (optional && response.status === 404) return undefined;
  throw new Error(`could not load ${url} (${response.status})`);
}

/** Custom stimulus generators the project refers to, loaded from custom/stimuli/<type>.js. */
async function loadGenerators(base, files) {
  const types = [...new Set((parseYaml(files['stimuli.yaml'] ?? 'stimuli: []')?.stimuli ?? []).map((s) => s.type))]
    .filter((type) => !BUILTIN_STIMULUS_TYPES.includes(type));
  const generators = {};
  const sources = {};
  for (const type of types) {
    const url = new URL(`custom/stimuli/${type}.js`, base).href;
    const source = await fetchText(url, { optional: true });
    if (source === undefined) continue;
    generators[type] = (await import(url)).default;
    sources[type] = source;
  }
  return { generators, sources };
}

/**
 * @param {{url: string, schemas: object, patchExperiment?: (doc: object) => void}} options
 *   `url` is the project folder URL; `patchExperiment` edits the parsed experiment.yaml
 *   (used by debug overrides) before compiling.
 * @returns {Promise<{plan: object|null, diagnostics: object[], generators: object, consentText?: string, specHash: string, customModules: object[]}>}
 */
export async function loadProject({ url, schemas, patchExperiment }) {
  const base = new URL(url, globalThis.location.href).href;
  const files = {};
  for (const name of FILES) {
    const text = await fetchText(new URL(name, base).href, { optional: name === 'forms.yaml' || name === 'stimuli.yaml' });
    if (text !== undefined) files[name] = text;
  }
  if (patchExperiment) {
    const doc = parseYaml(files['experiment.yaml']);
    patchExperiment(doc);
    files['experiment.yaml'] = dump(doc);
  }
  const { generators, sources } = await loadGenerators(base, files);
  const manifests = Object.fromEntries(Object.entries(generators).map(([type, generator]) => [type, JSON.parse(JSON.stringify(generator))]));
  const result = compile({ files, schemas, custom: { tasks: {}, stimuli: manifests }, assets: null });

  const experiment = parseYaml(files['experiment.yaml']);
  const consentText = experiment.consent?.file ? await fetchText(new URL(experiment.consent.file, base).href) : experiment.consent?.text;
  const specHash = await hashText(JSON.stringify({ files, sources, consentText }));
  const customModules = await Promise.all(Object.entries(sources).map(async ([name, source]) => ({ kind: 'stimulus', name, hash: await hashText(source) })));

  return { plan: result.plan, diagnostics: result.diagnostics, generators, consentText, specHash, customModules };
}
