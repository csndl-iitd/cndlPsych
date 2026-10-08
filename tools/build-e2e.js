// Bundle the browser test apps (framework + jsPsych + a validator) into dist/e2e/.
import { build } from 'esbuild';
import { localFontsOnly, webgazerAddOn } from './esbuild-plugins.js';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(root, 'tools', 'e2e', 'app.js'), join(root, 'tools', 'e2e', 'session.js')],
  outdir: join(root, 'dist', 'e2e'),
  bundle: true,
  format: 'esm',
  splitting: true, // WebGazer is a dynamic import: it must stay in its own file, loaded only when eye tracking runs
  platform: 'browser',
  plugins: [localFontsOnly, webgazerAddOn(join(root, 'bundle', 'eyetracking-addon.js'))], // tests run the add-on module directly
  sourcemap: true,
  logLevel: 'warning',
});
console.log('built dist/e2e');
