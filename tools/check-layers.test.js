import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkSource, checkTree } from './check-layers.js';

describe('checkSource', () => {
  it.each([
    ['foundation importing pipeline', 'foundation/clock.js', "import { x } from '../pipeline/input.js';"],
    ['foundation importing a package', 'foundation/clock.js', "import yaml from 'js-yaml';"],
    ['pipeline importing storage', 'pipeline/input.js', "import { x } from '../storage/local.js';"],
    ['stage importing authoring', 'stage/stage.js', "export { x } from '../authoring/spec.js';"],
    ['authoring importing runtime', 'authoring/spec.js', "import '../runtime/boot.js';"],
    ['jsPsych outside bridge and modules', 'pipeline/input.js', "import { initJsPsych } from 'jspsych';"],
    ['jsPsych in authoring but not in modules', 'authoring/compiler.js', "import { initJsPsych } from 'jspsych';"],
    ['static Firebase import', 'storage/firebase.js', "import { initializeApp } from 'firebase/app';"],
    ['dynamic Firebase import outside firebase.js', 'storage/local.js', "const m = await import('firebase/app');"],
    ['static WebGazer import', 'pipeline/gaze.js', "import webgazer from 'webgazer';"],
    ['dynamic WebGazer import outside gaze.js', 'pipeline/input.js', "const w = await import('webgazer');"],
  ])('rejects %s', (_label, file, source) => {
    expect(checkSource(file, source)).toHaveLength(1);
  });

  it.each([
    ['foundation sibling', 'foundation/events.js', "import { now } from './clock.js';"],
    ['pipeline using foundation', 'pipeline/mapping.js', "import { matches } from '../foundation/matcher.js';"],
    ['authoring using a package', 'authoring/spec.js', "import yaml from 'js-yaml';\nimport { x } from '../foundation/session.js';"],
    ['runtime using every layer', 'runtime/boot.js', "import { a } from '../storage/local.js';\nimport { b } from '../authoring/compiler.js';"],
    ['bridge using jsPsych', 'pipeline/bridge.js', "import { initJsPsych } from 'jspsych';"],
    ['module using jsPsych', 'authoring/modules/survey.js', "import survey from '@jspsych/plugin-survey';"],
    ['dynamic Firebase in firebase.js', 'storage/firebase.js', "const m = await import('firebase/app');"],
    ['dynamic WebGazer in gaze.js', 'pipeline/gaze.js', "const w = await import('webgazer');"],
    ['a multi-line import', 'pipeline/input.js', "import {\n  a,\n  b,\n} from '../foundation/clock.js';"],
  ])('accepts %s', (_label, file, source) => {
    expect(checkSource(file, source)).toEqual([]);
  });

  it('reports the offending file and specifier', () => {
    const [message] = checkSource('stage/cursor.js', "import { x } from '../runtime/boot.js';");
    expect(message).toContain('stage/cursor.js');
    expect(message).toContain('../runtime/boot.js');
  });
});

describe('checkTree', () => {
  let dir;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function tree(files) {
    dir = mkdtempSync(join(tmpdir(), 'layers-'));
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    return dir;
  }

  it('finds a deliberately bad import in a real directory', () => {
    const root = tree({
      'foundation/clock.js': 'export const now = () => 0;\n',
      'pipeline/input.js': "import { x } from '../storage/local.js';\n",
    });
    expect(checkTree(root)).toEqual([expect.stringContaining('pipeline/input.js')]);
  });

  it('passes a clean tree and ignores test files', () => {
    const root = tree({
      'foundation/clock.js': 'export const now = () => 0;\n',
      'foundation/clock.test.js': "import { it } from 'vitest';\n",
      'foundation/clock.e2e.js': "import { test } from '@playwright/test';\n",
      'pipeline/input.js': "import { now } from '../foundation/clock.js';\n",
    });
    expect(checkTree(root)).toEqual([]);
  });
});
