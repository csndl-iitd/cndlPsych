// Bundle the browser test apps (framework + jsPsych + a validator) into dist/e2e/.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(root, 'tools', 'e2e', 'app.js'), join(root, 'tools', 'e2e', 'session.js')],
  outdir: join(root, 'dist', 'e2e'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  loader: { '.css': 'text' },
  sourcemap: true,
  logLevel: 'warning',
});
console.log('built dist/e2e');
