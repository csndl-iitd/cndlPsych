// Create a new experiment folder: a template project plus the bundled framework.
//
//   node cli/init.js <dir> [--template basic|timing]
//
// basic is a minimal reaction-time study; timing is the display / trigger latency measurement (docs/timing.md).
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'expfw');
const TEMPLATES = { basic: 'template', timing: 'template-timing' };

/** @returns {string} the created folder */
export function initProject(target, { template = 'basic' } = {}) {
  if (!TEMPLATES[template]) throw new Error(`unknown template "${template}" (${Object.keys(TEMPLATES).join(', ')})`);
  const dir = resolve(target);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty`);
  if (!existsSync(join(DIST, 'boot.js'))) execFileSync(process.execPath, [join(ROOT, 'tools', 'build-dist.js')], { stdio: 'inherit' });
  cpSync(join(ROOT, TEMPLATES[template]), dir, { recursive: true });
  cpSync(DIST, join(dir, 'expfw'), { recursive: true });
  return dir;
}

function main() {
  const { values, positionals: [target] } = parseArgs({ allowPositionals: true, options: { template: { type: 'string', default: 'basic' } } });
  if (!target) {
    console.error('usage: expfw init <folder> [--template basic|timing]');
    process.exit(2);
  }
  try {
    const dir = initProject(target, { template: values.template });
    console.log(`created ${dir}\n\nnext:\n  expfw validate ${target}\n  expfw serve ${target}\nedit experiment.yaml, stimuli.yaml, timeline.yaml and forms.yaml; index.html rarely changes.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] === import.meta.filename) main();
