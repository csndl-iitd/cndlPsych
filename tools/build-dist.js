// Build the user-facing folders into dist/:
//
//   cndlpsych/                 the framework, as source: the same readable ES modules as framework/,
//                          unminified and unbundled, plus the third-party code it needs
//   cndlpsych-eyetracking/     the eye tracking add-on: WebGazer (GPL-3.0-or-later) and its face model
//
// `cndlpsych init` copies cndlpsych/ next to a new experiment (and the add-on with --eyetracking); users never
// edit them. The browser loads the modules directly (an import map in boot.js points the third-party
// module names at cndlpsych/vendor/), so there are no bundles, no hashes and no generated names.
//
//   node tools/build-dist.js
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SURVEY_CSS, VENDOR } from '../bundle/vendor.js';
import { stripRemoteFonts } from './esbuild-plugins.js';
import { bundledPackages, noticesFor } from './notices.js';

const root = join(import.meta.dirname, '..');
// CNDLPSYCH_DIST_DIR lets a test build somewhere else without touching the folders other tests copy from.
const out = process.env.CNDLPSYCH_DIST_DIR ?? join(root, 'dist');
export const DIST = join(out, 'cndlpsych');
export const DIST_EYETRACKING = join(out, 'cndlpsych-eyetracking');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const README = `cndlpsych ${version}: the framework. Do not edit these files; they are replaced when you update.

boot.js        what index.html loads; says where the third-party modules are, then starts start.js
start.js       loads the schemas and runs the framework on the files next to index.html
framework/     the framework's own code, one folder per layer (read ARCHITECTURE.md in the repository)
  foundation/  clock, event bus, matcher, random numbers, session record: depends on nothing
  pipeline/    input, gestures, input mapping, triggers and sinks, frame timing, eye tracking
  stage/       the stage, its layout, cursor and overlays
  storage/     local storage (IndexedDB), Firebase, export formats (BIDS, CSV, JSONL)
  authoring/   the YAML compiler and the modules that run blocks (instructions, response task, survey)
  runtime/     wires everything together and runs a session
schemas/       the JSON Schemas the YAML files are checked against
vendor/        third-party code, one readable file per package (see THIRD-PARTY-LICENSES.txt)
types.d.ts     types for custom stimuli and tasks
cli/           the command line tools (validate, serve, dry-run, deploy, listen, relay, export-firestore, migrate)
firebase/      the Firestore rules and indexes that deploy publishes
package.json   says the files here are ES modules

The tools need Node.js 20.6 or newer. From the folder that holds index.html:

  node cndlpsych/cli/cndlpsych.js validate .         check the YAML files
  node cndlpsych/cli/cndlpsych.js serve .            open http://localhost:8080
  node cndlpsych/cli/cndlpsych.js dry-run .          play it with a synthetic participant (npm install @playwright/test; npx playwright install chromium)
  node cndlpsych/cli/cndlpsych.js listen --ack       show the triggers a websocket sink sends
  node cndlpsych/cli/cndlpsych.js relay --port COM3  websocket to serial port (npm install serialport)
  node cndlpsych/cli/cndlpsych.js deploy .           publish to Firebase Hosting (needs firebase-tools: npx firebase-tools login)
  node cndlpsych/cli/cndlpsych.js export-firestore   Firestore sessions as BIDS (npm install firebase-admin)

The same commands are npm scripts in package.json (npm run validate, npm run serve, ...).
`;

const copyText = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, readFileSync(from, 'utf8').replace(/\r\n/g, '\n'));
};

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (entry.name.endsWith('.js') && !/\.(test|e2e)\.js$/.test(entry.name)) yield path;
  }
}

for (const dir of [DIST, DIST_EYETRACKING]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// ---- the framework itself: copied, not transformed ----
const frameworkDir = join(root, 'framework');
for (const file of sourceFiles(frameworkDir)) copyText(file, join(DIST, 'framework', file.slice(frameworkDir.length + 1)));
for (const file of ['boot.js', 'start.js']) copyText(join(root, 'bundle', file), join(DIST, file));
copyText(join(root, 'spec', 'types.d.ts'), join(DIST, 'types.d.ts'));

// ---- the command line tools: the same files as cli/ (not init, which needs the repository), the Firestore rules deploy publishes,
// and a hook that finds the two packages they import (js-yaml, ajv) in vendor/ instead of in node_modules ----
const cliDir = join(root, 'cli');
for (const name of readdirSync(cliDir).filter((file) => file.endsWith('.js') && !/\.(test|e2e)\.js$/.test(file) && file !== 'init.js')) copyText(join(cliDir, name), join(DIST, 'cli', name));
writeFileSync(join(DIST, 'cli', 'register.mjs'), `// Loaded by cndlpsych.js (node --import): lets the tools import js-yaml and ajv from ../vendor/.
import { register } from 'node:module';

register('./resolve-vendor.mjs', import.meta.url);
`);
writeFileSync(join(DIST, 'cli', 'resolve-vendor.mjs'), `// Resolves the third-party modules the tools import to the readable copies in ../vendor/.
const VENDOR = new URL('../vendor/', import.meta.url);
const FILES = { 'js-yaml': 'js-yaml.js', ajv: 'ajv.js' };

export async function resolve(specifier, context, next) {
  if (specifier in FILES) return { url: new URL(FILES[specifier], VENDOR).href, shortCircuit: true };
  return next(specifier, context);
}
`);
writeFileSync(join(DIST, 'package.json'), '{ "type": "module" }\n');
for (const name of ['firestore.public.rules', 'firestore.controlled.rules', 'firestore.indexes.json']) copyText(join(root, 'spec', 'firebase', name), join(DIST, 'firebase', name));

const schemaFiles = readdirSync(join(root, 'spec', 'schema')).filter((name) => name.endsWith('.schema.json')).sort();
for (const name of schemaFiles) copyText(join(root, 'spec', 'schema', name), join(DIST, 'schemas', name));
writeFileSync(join(DIST, 'schemas', 'index.json'), `${JSON.stringify(schemaFiles, null, 2)}\n`);

// ---- third-party code: one readable file per package ----
const bundled = new Set(['@jspsych/plugin-survey']); // its stylesheet is copied below
for (const vendor of VENDOR) {
  const result = await build({
    stdin: { contents: vendor.entry, resolveDir: root, sourcefile: `vendor/${vendor.file}` },
    outfile: join(DIST, 'vendor', vendor.file),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    minify: false,
    external: vendor.external ?? [],
    legalComments: 'inline',
    metafile: true,
    logLevel: 'warning',
  });
  bundledPackages(result.metafile).forEach((name) => bundled.add(name));
}
writeFileSync(join(DIST, 'vendor', SURVEY_CSS.file), stripRemoteFonts(readFileSync(join(root, 'node_modules', SURVEY_CSS.from), 'utf8')));

cpSync(join(root, 'LICENSE'), join(DIST, 'LICENSE'));
writeFileSync(join(DIST, 'THIRD-PARTY-LICENSES.txt'), noticesFor([...bundled].sort(), 'Third-party software in cndlpsych/vendor/ (all under permissive licences).'));
writeFileSync(join(DIST, 'VERSION'), `cndlpsych ${version}\n`);
writeFileSync(join(DIST, 'README.txt'), README);

// ---- add-on: WebGazer and the face model it loads ----
const addOn = await build({
  entryPoints: [join(root, 'bundle', 'eyetracking-addon.js')],
  outfile: join(DIST_EYETRACKING, 'webgazer.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: false,
  legalComments: 'inline',
  metafile: true,
  logLevel: 'warning',
});
cpSync(join(root, 'node_modules', 'webgazer', 'dist', 'mediapipe'), join(DIST_EYETRACKING, 'mediapipe'), { recursive: true });
cpSync(join(root, 'node_modules', 'webgazer', 'LICENSE.md'), join(DIST_EYETRACKING, 'LICENSE.md'));
cpSync(join(root, 'LICENSE-eyetracking.md'), join(DIST_EYETRACKING, 'README.md'));
writeFileSync(join(DIST_EYETRACKING, 'THIRD-PARTY-LICENSES.txt'), noticesFor(bundledPackages(addOn.metafile), 'Software in cndlpsych-eyetracking/ (WebGazer is GPL-3.0-or-later; the rest is listed with its own licence).'));
writeFileSync(join(DIST_EYETRACKING, 'VERSION'), `cndlpsych-eyetracking ${version}\n`);
console.log(`built ${DIST} and ${DIST_EYETRACKING}`);
