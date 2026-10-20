import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deployPlan } from './deploy.js';
import { summarise } from './dry-run.js';
import { initProject } from './init.js';
import { CURRENT_VERSION, migrateDocument } from './migrate.js';
import { serveDirectory } from './serve.js';
import { validateProject } from './validate.js';

const ROOT = join(import.meta.dirname, '..');
const TEMPLATE = join(ROOT, 'template');
const CNDLPSYCH = join(ROOT, 'cli', 'cndlpsych.js');
const temp = [];
const tempDir = () => { const dir = mkdtempSync(join(tmpdir(), 'cndlpsych-cli-')); temp.push(dir); return dir; };
afterAll(() => temp.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('template', () => {
  it('is a valid project with no warnings', async () => {
    const { diagnostics, ok } = await validateProject(TEMPLATE);
    expect(diagnostics).toEqual([]);
    expect(ok).toBe(true);
  });

  it('has only YAML, one consent file and index.html for the user to edit', () => {
    expect(readdirSync(TEMPLATE).sort()).toEqual(['assets', 'consent.md', 'experiment.yaml', 'forms.yaml', 'index.html', 'stimuli.yaml', 'timeline.yaml']);
    expect(readFileSync(join(TEMPLATE, 'index.html'), 'utf8')).toContain('src="cndlpsych/boot.js"');
  });
});

// The words of the rule language (matching events, producing responses and triggers) are documented in docs/yaml/; the template names the settings.
const RULE_LANGUAGE = new Set([
  'match', 'where', 'all', 'any', 'not', 'eq', 'ne', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'glob', 'regex', 'exists', 'sequence', 'distinct_by', 'within', 'frames',
  'unordered', 'emit', 'intent', 'event', 'end_trial', 'effect', 'target', 'add_class', 'style', 'revert_after', 'data', 'consume', 'priority', 'from', 'map', 'by', 'table',
  'default', 'once', 'allow_multiple',
]);

/** Every setting name of a schema, following references into the other schema files. */
function settingNames() {
  const files = {};
  const load = (name) => (files[name] ??= JSON.parse(readFileSync(join(ROOT, 'spec', 'schema', name), 'utf8')));
  const names = new Set();
  const seen = new Set();
  const walk = (node, file) => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) {
      const [target, pointer] = node.$ref.split('#');
      const name = target || file;
      if (seen.has(`${name}#${pointer}`)) return;
      seen.add(`${name}#${pointer}`);
      walk(pointer.split('/').filter(Boolean).reduce((found, part) => found[part], load(name)), name);
      return;
    }
    for (const [name, child] of Object.entries(node.properties ?? {})) { names.add(name); walk(child, file); }
    for (const list of [node.anyOf, node.oneOf, node.allOf]) list?.forEach((child) => walk(child, file));
    walk(node.items, file);
    walk(node.then, file);
    if (typeof node.additionalProperties === 'object') walk(node.additionalProperties, file);
  };
  walk(load('experiment.schema.json'), 'experiment.schema.json');
  return [...names].filter((name) => !RULE_LANGUAGE.has(name));
}

const NL = '\n';

describe('template experiment.yaml', () => {
  const text = readFileSync(join(TEMPLATE, 'experiment.yaml'), 'utf8');

  it('shows every setting of experiment.yaml, switched off, so a new one cannot be forgotten', () => {
    const missing = settingNames().filter((name) => !new RegExp(`(^|[^A-Za-z_])${name}:`).test(text));
    expect(missing).toEqual([]);
  });

  it('is valid with all the switched-off settings switched on (the alternatives left out)', async () => {
    const stubs = text.split(/\r?\n/).flatMap((line) => {
      const comment = /^(\s*)#\s?(.*)$/.exec(line);
      if (!comment) return [line];
      const body = comment[2];
      return /^(-\s|[A-Za-z_]+:)/.test(body.trimStart()) && !/^\s*(Everything|Lines|Every|Settings every|More for|"go"|A device|text:)/.test(body) ? [`${comment[1]}${body}`] : [];
    }).filter((line) => !/^ {2}local:.*enabled: true, recovery/.test(line) && !/^ {2}select: auto/.test(line)).join(NL);
    const dir = join(tempDir(), 'all-settings');
    initProject(dir);
    writeFileSync(join(dir, 'experiment.yaml'), stubs.replace(`device:${NL}`, `device:${NL}  select: fixed${NL}`));
    const { diagnostics } = await validateProject(dir);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('init', () => {
  it('creates the template and the bundled framework, and refuses a folder that is not empty', () => {
    const dir = join(tempDir(), 'my-study');
    initProject(dir);
    for (const file of ['index.html', 'experiment.yaml', 'timeline.yaml', 'cndlpsych/boot.js', 'cndlpsych/start.js', 'cndlpsych/framework/runtime/boot.js', 'cndlpsych/vendor/jspsych.js', 'cndlpsych/LICENSE']) expect(existsSync(join(dir, file)), file).toBe(true);
    expect(existsSync(join(dir, 'cndlpsych-eyetracking'))).toBe(false);
    expect(() => initProject(dir)).toThrow('not empty');
  });

  it('copies the eye tracking add-on only when asked', () => {
    const dir = join(tempDir(), 'eye-study');
    initProject(dir, { eyetracking: true });
    for (const file of ['cndlpsych-eyetracking/webgazer.js', 'cndlpsych-eyetracking/LICENSE.md', 'cndlpsych-eyetracking/mediapipe/face_mesh/face_mesh.binarypb']) expect(existsSync(join(dir, file)), file).toBe(true);
  });

  it('the folder it creates passes validate', async () => {
    const dir = join(tempDir(), 'checked');
    initProject(dir);
    expect((await validateProject(dir)).ok).toBe(true);
  });
});

describe('serve', () => {
  it('serves files with the right types, index.html for folders, 404 for the rest, and nothing outside the folder', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'index.html'), '<p>hi</p>');
    writeFileSync(join(dir, 'a.yaml'), 'x: 1');
    const served = await serveDirectory({ dir });
    try {
      const get = (path) => fetch(`${served.url}${path}`);
      expect(await (await get('')).text()).toBe('<p>hi</p>');
      expect((await get('a.yaml')).headers.get('content-type')).toContain('text/plain');
      expect((await get('missing.png')).status).toBe(404);
      expect((await fetch(`${served.url}%2e%2e/secret`)).status).toBeGreaterThanOrEqual(403);
    } finally {
      await served.close();
    }
  });

  it('can rewrite a file on its way out', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'a.yaml'), 'x: 1');
    const served = await serveDirectory({ dir, rewrite: (path, body) => (path === '/a.yaml' ? `${body}\ny: 2` : body) });
    try {
      expect(await (await fetch(`${served.url}a.yaml`)).text()).toBe('x: 1\ny: 2');
    } finally {
      await served.close();
    }
  });
});

describe('migrate', () => {
  it('leaves a current project alone', () => {
    expect(migrateDocument({ spec_version: CURRENT_VERSION, name: 'x' })).toMatchObject({ from: 1, to: 1 });
  });

  it('refuses a newer version and a missing one, with a message the user can act on', () => {
    expect(() => migrateDocument({ spec_version: CURRENT_VERSION + 1 })).toThrow('update cndlpsych');
    expect(() => migrateDocument({ name: 'x' })).toThrow('spec_version');
  });

  it('the command reports a current project', () => {
    expect(execFileSync(process.execPath, [CNDLPSYCH, 'migrate', TEMPLATE], { encoding: 'utf8' })).toContain('nothing to do');
  });
});

describe('deploy', () => {
  it('hosting only when Firebase storage is off; deployment config stays out of what is published', () => {
    const plan = deployPlan({ storage: { local: { enabled: true } } });
    expect(plan.services).toEqual(['hosting']);
    expect(plan.files).toEqual([]);
    expect(plan.config.hosting.public).toBe('.');
    expect(plan.config.hosting.ignore).toEqual(expect.arrayContaining(['firebase.json', '.firebaserc', 'firebase/**', '**/.*']));
  });

  it.each(['public', 'controlled'])('adds the %s rules and indexes when Firebase storage is on, and takes the project id from the config', (access) => {
    const plan = deployPlan({ storage: { firebase: { enabled: true, access, web_config: { projectId: 'my-proj' } } } });
    expect(plan.services).toEqual(['hosting', 'firestore']);
    expect(plan.projectId).toBe('my-proj');
    expect(plan.files.map((f) => f.path)).toEqual(['firebase/firestore.rules', 'firebase/firestore.indexes.json']);
    expect(plan.files[0].data).toBe(readFileSync(join(ROOT, 'spec', 'firebase', `firestore.${access}.rules`), 'utf8'));
    expect(plan.config.firestore.rules).toBe('firebase/firestore.rules');
  });

  it('--hosting-only leaves the Firestore rules and indexes out', () => {
    const plan = deployPlan({ storage: { firebase: { enabled: true, access: 'controlled', web_config: { projectId: 'my-proj' } } } }, { hostingOnly: true });
    expect(plan.services).toEqual(['hosting']);
    expect(plan.files).toEqual([]);
    expect(plan.config).not.toHaveProperty('firestore');
    expect(plan.projectId).toBe('my-proj');
  });

  it('--print writes nothing', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'experiment.yaml'), 'spec_version: 1\n');
    const out = execFileSync(process.execPath, [CNDLPSYCH, 'deploy', dir, '--project', 'p1', '--print'], { encoding: 'utf8' });
    expect(out).toContain('npx firebase-tools deploy --project p1 --only hosting');
    expect(existsSync(join(dir, 'firebase.json'))).toBe(false);
  });
});

describe('cndlpsych command', () => {
  it('exits non-zero for an unknown command', () => {
    expect(() => execFileSync(process.execPath, [CNDLPSYCH, 'nope'], { stdio: 'pipe' })).toThrow();
  });
});

describe('dry-run report', () => {
  const event = (seq, type, data, extra = {}) => ({ seq, t: seq * 10, type, data, block: 'b', trial: null, ...extra });

  it('summarises blocks, outcomes, triggers and problems', () => {
    const events = [
      event(0, 'block.start', { block_id: 'b' }),
      event(1, 'trial.end', { trial: 1, outcome: 'correct' }, { trial: 1 }),
      event(2, 'trial.end', { trial: 2, outcome: 'timeout' }, { trial: 2 }),
      event(3, 'trigger.sent', { sink: 's', rule: 'r', value: 5 }),
      event(4, 'system.warning', { code: 'w', message: 'careful' }),
      event(5, 'block.end', { reason: 'complete' }),
    ];
    const text = summarise({ events, record: { subject_id: 'sub-1', session_id: 'ses-1', status: 'complete', last_seq: 5 }, status: 'complete', devices: [{ via: 'serial', data: '05' }], responses: 2 });
    expect(text).toContain('b                        2 trial(s) (1 correct, 1 timeout)  ended: complete');
    expect(text).toContain('s <- r: 1x, values 5');
    expect(text).toContain('serial: 05');
    expect(text).toContain('warning w: careful');
  });

  it('says where a run got stuck', () => {
    expect(summarise({ events: [], record: null, status: 'running', devices: [], responses: 0, stuck: 'no progress' })).toContain('STUCK: no progress');
  });
});
