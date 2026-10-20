// Create a new experiment folder: a template project plus the bundled framework.
//
//   node cli/init.js <dir> [--template basic|timing] [--eyetracking]
//
// basic is a minimal reaction-time study; timing is the display / trigger latency measurement (docs/timing.md).
// --eyetracking also copies the eye tracking add-on (WebGazer, GPL-3.0-or-later; see LICENSE-eyetracking.md).
import { cpSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist', 'cndlpsych');
const DIST_EYETRACKING = join(ROOT, 'dist', 'cndlpsych-eyetracking');
const TEMPLATES = { basic: 'template', timing: 'template-timing' };

/** @returns {string} the created folder */
export function initProject(target, { template = 'basic', eyetracking = false } = {}) {
  if (!TEMPLATES[template]) throw new Error(`unknown template "${template}" (${Object.keys(TEMPLATES).join(', ')})`);
  const dir = resolve(target);
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty`);
  if (!existsSync(join(DIST, 'boot.js'))) execFileSync(process.execPath, [join(ROOT, 'tools', 'build-dist.js')], { stdio: 'inherit' });
  cpSync(join(ROOT, TEMPLATES[template]), dir, { recursive: true });
  cpSync(DIST, join(dir, 'cndlpsych'), { recursive: true });
  if (eyetracking) cpSync(DIST_EYETRACKING, join(dir, 'cndlpsych-eyetracking'), { recursive: true });
  return dir;
}

function main() {
  const { values, positionals: [target] } = parseArgs({ allowPositionals: true, options: { template: { type: 'string', default: 'basic' }, eyetracking: { type: 'boolean', default: false } } });
  if (!target) {
    console.error('usage: cndlpsych init <folder> [--template basic|timing] [--eyetracking]');
    process.exit(2);
  }
  try {
    const dir = initProject(target, { template: values.template, eyetracking: values.eyetracking });
    console.log(`created ${dir}\n\nnext:\n  cndlpsych validate ${target}\n  cndlpsych serve ${target}\nedit experiment.yaml, stimuli.yaml, timeline.yaml and forms.yaml; index.html rarely changes.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (process.argv[1] === import.meta.filename) main();
