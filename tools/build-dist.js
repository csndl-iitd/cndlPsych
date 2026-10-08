// Build the user-facing framework folder: dist/expfw/ (boot.js, its chunks, WebGazer's face
// model). `expfw init` copies it next to a new experiment; users never edit it.
//
//   node tools/build-dist.js
import { build } from 'esbuild';
import { localFontsOnly } from './esbuild-plugins.js';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
export const DIST = join(root, 'dist', 'expfw');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
await build({
  entryPoints: { boot: join(root, 'bundle', 'entry.js') },
  outdir: DIST,
  bundle: true,
  format: 'esm',
  splitting: true, // WebGazer and Firebase are dynamic imports: separate files, fetched only when used
  platform: 'browser',
  minify: true,
  plugins: [localFontsOnly],
  legalComments: 'external',
  logLevel: 'warning',
});
// WebGazer looks for its MediaPipe face model next to the script (see pipeline/gaze.js).
cpSync(join(root, 'node_modules', 'webgazer', 'dist', 'mediapipe'), join(DIST, 'mediapipe'), { recursive: true });
writeFileSync(join(DIST, 'VERSION'), `expfw ${version}\n`);
console.log(`built ${DIST}`);
