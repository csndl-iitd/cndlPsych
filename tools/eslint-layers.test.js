import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: root });

async function ruleIds(file, code) {
  const [result] = await eslint.lintText(code, { filePath: join(root, file) });
  return result.messages.map((message) => message.ruleId);
}

describe('ESLint layer rules', () => {
  it.each([
    ['foundation importing pipeline', 'framework/foundation/clock.js', "import { x } from '../pipeline/input.js';\nexport { x };\n"],
    ['foundation importing a package', 'framework/foundation/clock.js', "import yaml from 'js-yaml';\nexport { yaml };\n"],
    ['pipeline importing storage', 'framework/pipeline/input.js', "import { x } from '../storage/local.js';\nexport { x };\n"],
    ['stage importing runtime', 'framework/stage/stage.js', "import { x } from '../runtime/boot.js';\nexport { x };\n"],
    ['authoring importing pipeline', 'framework/authoring/compiler.js', "import { x } from '../pipeline/input.js';\nexport { x };\n"],
    ['jsPsych outside bridge/modules', 'framework/pipeline/input.js', "import { initJsPsych } from 'jspsych';\nexport { initJsPsych };\n"],
    ['static Firebase import', 'framework/storage/firebase.js', "import { initializeApp } from 'firebase/app';\nexport { initializeApp };\n"],
    ['static WebGazer import', 'framework/pipeline/gaze.js', "import webgazer from 'webgazer';\nexport { webgazer };\n"],
  ])('rejects %s', async (_label, file, code) => {
    expect(await ruleIds(file, code)).toContain('no-restricted-imports');
  });

  it.each([
    ['dynamic Firebase outside firebase.js', 'framework/storage/local.js', "export const load = () => import('firebase/app');\n"],
    ['dynamic WebGazer outside gaze.js', 'framework/pipeline/input.js', "export const load = () => import('webgazer');\n"],
  ])('rejects %s', async (_label, file, code) => {
    expect(await ruleIds(file, code)).toContain('no-restricted-syntax');
  });

  it.each([
    ['foundation sibling', 'framework/foundation/events.js', "import { now } from './clock.js';\nexport { now };\n"],
    ['pipeline using foundation', 'framework/pipeline/mapping.js', "import { m } from '../foundation/matcher.js';\nexport { m };\n"],
    ['runtime using every layer', 'framework/runtime/boot.js', "import { a } from '../storage/local.js';\nexport { a };\n"],
    ['bridge using jsPsych', 'framework/pipeline/bridge.js', "import { initJsPsych } from 'jspsych';\nexport { initJsPsych };\n"],
    ['dynamic Firebase in firebase.js', 'framework/storage/firebase.js', "export const load = () => import('firebase/app');\n"],
    ['dynamic WebGazer in gaze.js', 'framework/pipeline/gaze.js', "export const load = () => import('webgazer');\n"],
  ])('accepts %s', async (_label, file, code) => {
    expect(await ruleIds(file, code)).toEqual([]);
  });

  it.each([
    ['localStorage', 'framework/runtime/boot.js', "export const v = localStorage.getItem('a');\n", 'no-restricted-globals'],
    ['window.sessionStorage', 'framework/runtime/boot.js', 'export const v = window.sessionStorage;\n', 'no-restricted-properties'],
    ['indexedDB outside storage/local.js', 'framework/runtime/boot.js', 'export const v = indexedDB;\n', 'no-restricted-globals'],
    ['Math.random in framework', 'framework/foundation/clock.js', 'export const v = Math.random();\n', 'no-restricted-properties'],
    ['Math.random in custom code', 'spec/examples/custom/tasks/t.js', 'export default { build: () => Math.random() };\n', 'no-restricted-properties'],
    ['a listener in custom code', 'spec/examples/custom/tasks/t.js', "export default { build: (ctx) => ctx.el.addEventListener('click', () => {}) };\n", 'no-restricted-syntax'],
    ['an import in custom code', 'spec/examples/custom/tasks/t.js', "import { x } from './other.js';\nexport default x;\n", 'no-restricted-imports'],
  ])('rejects %s', async (_label, file, code, rule) => {
    expect(await ruleIds(file, code)).toContain(rule);
  });

  it('allows indexedDB inside storage/local.js', async () => {
    expect(await ruleIds('framework/storage/local.js', 'export const open = () => indexedDB.open("log");\n')).toEqual([]);
  });
});
