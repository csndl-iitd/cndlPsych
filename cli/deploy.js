// Publish an experiment to Firebase Hosting (and, when Firebase storage is on, deploy the
// matching Firestore rules and indexes). The files it writes into the project are
// `firebase.json` and `firebase/firestore.*`; the upload itself is done by firebase-tools,
// which you must be logged in to (`npx firebase-tools login`).
//
//   node cli/deploy.js <project-dir> [--project <firebase-project-id>] [--site <hosting-site-id>] [--hosting-only] [--print]
//
// --site publishes to that Hosting site of the project (a project can have several; the default site is named after the project).
// --print only shows what would be written and run. --hosting-only leaves the project's Firestore
// rules and indexes alone (deploying them replaces whatever rules the project has).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { load } from 'js-yaml';

// The Firestore rules: spec/firebase in the repository, cndlpsych/firebase in a project folder.
const RULES = existsSync(join(import.meta.dirname, '..', 'spec', 'firebase')) ? join(import.meta.dirname, '..', 'spec', 'firebase') : join(import.meta.dirname, '..', 'firebase');
// Everything in the folder is public: keep deployment config, the command line tools and editor files out of it.
const HOSTING_IGNORE = ['firebase.json', '.firebaserc', 'firebase/**', 'package.json', 'package-lock.json', 'cndlpsych/cli/**', 'cndlpsych/firebase/**', 'cndlpsych/package.json', '**/.*', '**/node_modules/**', '**/*.LEGAL.txt'];

/**
 * @param {object} experiment parsed experiment.yaml
 * @param {{hostingOnly?: boolean, site?: string}} [options]
 * @returns {{config: object, files: {path: string, data: string}[], services: string[], projectId?: string}}
 */
export function deployPlan(experiment, { hostingOnly = false, site } = {}) {
  const firebase = experiment.storage?.firebase;
  const useFirestore = firebase?.enabled === true && !hostingOnly;
  const services = ['hosting', ...(useFirestore ? ['firestore'] : [])];
  const config = { hosting: { ...(site ? { site } : {}), public: '.', ignore: HOSTING_IGNORE, headers: [{ source: '**/*.@(js|yaml|json|md)', headers: [{ key: 'Cache-Control', value: 'no-cache' }] }] } };
  const files = [];
  if (useFirestore) {
    config.firestore = { rules: 'firebase/firestore.rules', indexes: 'firebase/firestore.indexes.json' };
    files.push(
      { path: 'firebase/firestore.rules', data: readFileSync(join(RULES, `firestore.${firebase.access}.rules`), 'utf8') },
      { path: 'firebase/firestore.indexes.json', data: readFileSync(join(RULES, 'firestore.indexes.json'), 'utf8') },
    );
  }
  return { config, files, services, projectId: firebase?.web_config?.projectId };
}

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { project: { type: 'string' }, print: { type: 'boolean', default: false }, 'hosting-only': { type: 'boolean', default: false }, site: { type: 'string' } } });
  const dir = resolve(positionals[0] ?? '.');
  const plan = deployPlan(load(readFileSync(join(dir, 'experiment.yaml'), 'utf8')), { hostingOnly: values['hosting-only'], site: values.site });
  const projectId = values.project ?? plan.projectId;
  if (!projectId) {
    console.error('no Firebase project: pass --project <id> or set storage.firebase.web_config.projectId');
    process.exit(2);
  }
  const command = ['firebase-tools', 'deploy', '--project', projectId, '--only', plan.services.join(',')];
  const written = [{ path: 'firebase.json', data: `${JSON.stringify(plan.config, null, 2)}\n` }, ...plan.files];
  if (values.print) {
    console.log(`in ${dir}, would write: ${written.map((f) => f.path).join(', ')}\nand run: npx ${command.join(' ')}`);
    return;
  }
  for (const file of written) {
    const path = join(dir, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.data);
  }
  const run = spawnSync('npx', ['--yes', ...command], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  process.exit(run.status ?? 1);
}

if (process.argv[1] === import.meta.filename) main();
