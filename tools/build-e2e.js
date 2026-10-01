// Bundle the browser test app (framework + jsPsych + a validator) into dist/e2e/app.js.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(root, 'tools', 'e2e', 'app.js')],
  outfile: join(root, 'dist', 'e2e', 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  sourcemap: true,
  logLevel: 'warning',
});
console.log('built dist/e2e/app.js');
