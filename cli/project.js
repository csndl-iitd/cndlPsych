// Read a project folder from disk into the shape framework/authoring/compiler.js expects.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SCHEMA_DIR = join(REPO, 'spec', 'schema');
const PROJECT_FILES = ['experiment.yaml', 'forms.yaml', 'stimuli.yaml', 'timeline.yaml'];
const IGNORED = new Set(['node_modules', '.git', 'expfw']);

function listFiles(root, dir = root) {
  return readdirSync(dir).flatMap((name) => {
    if (IGNORED.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(root, path) : [relative(root, path).split(sep).join('/')];
  });
}

function readSchemas(schemaDir) {
  return Object.fromEntries(readdirSync(schemaDir)
    .filter((name) => name.endsWith('.schema.json'))
    .map((name) => [name, JSON.parse(readFileSync(join(schemaDir, name), 'utf8'))]));
}

/** The declarative half of each custom module: its default export with functions dropped. */
async function readManifests(dir, loadProblems) {
  const manifests = {};
  if (!existsSync(dir)) return manifests;
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    try {
      const module = await import(pathToFileURL(join(dir, file)).href);
      manifests[file.replace(/\.js$/, '')] = JSON.parse(JSON.stringify(module.default));
    } catch (error) {
      loadProblems.push({ file: `${relative(dirname(dirname(dir)), join(dir, file)).split(sep).join('/')}`, message: error.message });
    }
  }
  return manifests;
}

/**
 * @returns {Promise<{project: object, loadProblems: {file: string, message: string}[]}>}
 */
export async function loadProject(root, { schemaDir = DEFAULT_SCHEMA_DIR } = {}) {
  const loadProblems = [];
  const files = {};
  for (const name of PROJECT_FILES) {
    const path = join(root, name);
    if (existsSync(path)) files[name] = readFileSync(path, 'utf8');
  }
  const project = {
    files,
    schemas: readSchemas(schemaDir),
    custom: {
      tasks: await readManifests(join(root, 'custom', 'tasks'), loadProblems),
      stimuli: await readManifests(join(root, 'custom', 'stimuli'), loadProblems),
    },
    assets: listFiles(root),
  };
  return { project, loadProblems };
}
