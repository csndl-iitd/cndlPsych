// CI check for the layer rules in CLAUDE.md. It complements the ESLint config: it also
// sees dynamic imports and `export ... from`, and it does not depend on lint config.
//
// Usage: node tools/check-layers.js [framework-dir]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYERS = ['foundation', 'pipeline', 'storage', 'stage', 'authoring', 'runtime'];
const ALLOWED_LAYERS = {
  foundation: [],
  pipeline: ['foundation'],
  storage: ['foundation'],
  stage: ['foundation'],
  authoring: ['foundation'],
  runtime: LAYERS,
};

const SDKS = [
  { name: 'jspsych', test: /^(jspsych|@jspsych\/)/, static: ['pipeline/bridge.js', 'authoring/modules/'], dynamic: [] },
  { name: 'firebase', test: /^firebase(\/|$)/, static: [], dynamic: ['storage/firebase.js'] },
  { name: 'webgazer', test: /^webgazer(\/|$)/, static: [], dynamic: ['pipeline/gaze.js'] },
];

const IMPORT_FORMS = [
  { dynamic: false, re: /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g },
  { dynamic: true, re: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
];

const isUnder = (file, allowed) => allowed.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * @param {string} file path relative to the framework dir, forward slashes (e.g. "pipeline/input.js")
 * @param {string} source file text
 * @returns {string[]} violations
 */
export function checkSource(file, source) {
  const layer = file.split('/')[0];
  if (!LAYERS.includes(layer)) return [];
  const problems = [];
  for (const { dynamic, re } of IMPORT_FORMS) {
    for (const match of source.matchAll(re)) {
      const problem = checkSpecifier(file, layer, match[1], dynamic);
      if (problem) problems.push(`${file}: ${problem}`);
    }
  }
  return problems;
}

function checkSpecifier(file, layer, specifier, dynamic) {
  if (specifier.startsWith('.')) {
    const targetLayer = posix.normalize(posix.join(posix.dirname(file), specifier)).split('/')[0];
    if (targetLayer === layer || ALLOWED_LAYERS[layer].includes(targetLayer)) return null;
    return `layer "${layer}" may not import "${specifier}"`;
  }
  const sdk = SDKS.find((candidate) => candidate.test.test(specifier));
  if (sdk) {
    const allowed = dynamic ? sdk.dynamic : sdk.static;
    return isUnder(file, allowed) ? null : `${dynamic ? 'dynamic ' : ''}import of ${sdk.name} ("${specifier}") is not allowed here`;
  }
  return layer === 'foundation' ? `foundation imports nothing ("${specifier}")` : null;
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (entry.endsWith('.js') && !entry.endsWith('.test.js') && !entry.endsWith('.e2e.js')) yield path;
  }
}

export function checkTree(frameworkDir) {
  return [...sourceFiles(frameworkDir)].flatMap((path) => {
    const file = relative(frameworkDir, path).split(sep).join('/');
    return checkSource(file, readFileSync(path, 'utf8'));
  });
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = resolve(process.argv[2] ?? join(root, 'framework'));
  const problems = checkTree(dir);
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.log('layer check passed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
