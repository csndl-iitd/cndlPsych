// Build the user-facing folders into dist/:
//   expfw/                 the framework (MIT, plus the permissive licences of what it bundles)
//   expfw-eyetracking/     the eye tracking add-on: WebGazer (GPL-3.0-or-later) and its face model
// `expfw init` copies expfw/ next to a new experiment (and the add-on with --eyetracking); users never edit them.
//
//   node tools/build-dist.js
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { localFontsOnly, namedFirebaseParts } from './esbuild-plugins.js';
import { bundledPackages, noticesFor } from './notices.js';

const root = join(import.meta.dirname, '..');
// EXPFW_DIST_DIR lets a test build somewhere else without touching the folders other tests copy from.
const out = process.env.EXPFW_DIST_DIR ?? join(root, 'dist');
export const DIST = join(out, 'expfw');
export const DIST_EYETRACKING = join(out, 'expfw-eyetracking');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const README = `expfw ${version}: the framework, bundled. Do not edit these files.

boot.js    what index.html loads
parts/     pieces boot.js loads only when an experiment needs them:
             firebase-*.js      the Firebase SDK (only if storage.firebase is enabled)
             eyetracking-stub   loads the eye tracking add-on from ../expfw-eyetracking/ (only if eye tracking is on)
             chunk-*.js         code shared between the above (the names carry a content hash)
LICENSE, THIRD-PARTY-LICENSES.txt   the licences of this software and of what it contains
`;
const common = { bundle: true, format: 'esm', platform: 'browser', minify: true, plugins: [localFontsOnly], legalComments: 'none', metafile: true, logLevel: 'warning' };

for (const dir of [DIST, DIST_EYETRACKING]) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// ---- core: no WebGazer; `webgazer` resolves to the stub that loads the add-on ----
const core = await build({
  ...common,
  plugins: [localFontsOnly, namedFirebaseParts(join(root, 'bundle', 'parts'))],
  entryPoints: { boot: join(root, 'bundle', 'entry.js') },
  outdir: DIST,
  splitting: true, // the Firebase SDK is a dynamic import: separate files, fetched only when used
  chunkNames: 'parts/[name]-[hash]', // everything except boot.js lives in expfw/parts/
  alias: { webgazer: join(root, 'bundle', 'eyetracking-stub.js') },
});
cpSync(join(root, 'LICENSE'), join(DIST, 'LICENSE'));
writeFileSync(join(DIST, 'THIRD-PARTY-LICENSES.txt'), noticesFor(bundledPackages(core.metafile), 'Third-party software bundled in expfw/ (all under permissive licences).'));
writeFileSync(join(DIST, 'VERSION'), `expfw ${version}\n`);
writeFileSync(join(DIST, 'README.txt'), README);

// ---- add-on: WebGazer and the face model it loads ----
const addOn = await build({ ...common, entryPoints: { webgazer: join(root, 'bundle', 'eyetracking-addon.js') }, outdir: DIST_EYETRACKING, splitting: false });
cpSync(join(root, 'node_modules', 'webgazer', 'dist', 'mediapipe'), join(DIST_EYETRACKING, 'mediapipe'), { recursive: true });
cpSync(join(root, 'node_modules', 'webgazer', 'LICENSE.md'), join(DIST_EYETRACKING, 'LICENSE.md'));
cpSync(join(root, 'LICENSE-eyetracking.md'), join(DIST_EYETRACKING, 'README.md'));
writeFileSync(join(DIST_EYETRACKING, 'THIRD-PARTY-LICENSES.txt'), noticesFor(bundledPackages(addOn.metafile), 'Software bundled in expfw-eyetracking/ (WebGazer is GPL-3.0-or-later; the rest is listed with its own licence).'));
writeFileSync(join(DIST_EYETRACKING, 'VERSION'), `expfw-eyetracking ${version}\n`);
console.log(`built ${DIST} and ${DIST_EYETRACKING}`);
