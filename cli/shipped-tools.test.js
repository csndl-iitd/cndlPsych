// The command line tools as an experimenter gets them: in cndlpsych/cli/ of a project made by `init`, run with
// plain Node from a folder with no node_modules anywhere above it (so the packages they import must come from
// cndlpsych/vendor/, through the hook).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { initProject } from './init.js';

const root = mkdtempSync(join(tmpdir(), 'cndlpsych-shipped-'));
const project = join(root, 'study');
initProject(project);
const tool = join(project, 'cndlpsych', 'cli', 'cndlpsych.js');
const run = (...args) => spawnSync(process.execPath, [tool, ...args], { cwd: tmpdir(), encoding: 'utf8' });
const children = [];
afterAll(() => {
  children.forEach((child) => child.kill());
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** Start a long-running tool and wait until it prints a line matching `ready`. */
function startTool(args, ready) {
  const child = spawn(process.execPath, [tool, ...args], { cwd: tmpdir() });
  children.push(child);
  let output = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${args[0]} did not start: ${output}`)), 10_000);
    const onData = (chunk) => {
      output += chunk;
      if (ready.test(output)) { clearTimeout(timer); resolve({ child, output: () => output }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

describe('the tools in a project folder', { timeout: 30_000 }, () => {
  it('lists the tools that are there (not init) and refuses an unknown one', () => {
    const result = run('nothing');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('validate|dry-run|serve|deploy|migrate|export-firestore|relay|listen');
    expect(result.stderr).not.toContain('init');
  });

  it('validate checks the YAML with the schemas of the project folder', () => {
    const result = run('validate', project);
    expect(result.stdout).toContain('0 error(s)');
    expect(result.status).toBe(0);
    writeFileSync(join(project, 'timeline.yaml'), 'blocks: not-a-list\n');
    const broken = run('validate', project);
    expect(broken.status).not.toBe(0);
    expect(broken.stdout).toContain('timeline.yaml');
  });

  it('deploy plans from the rules that came with the folder, migrate reads the version', () => {
    expect(run('deploy', project, '--print', '--project', 'demo').stdout).toContain('npx firebase-tools deploy --project demo --only hosting');
    expect(run('migrate', project).stdout).toContain('nothing to do');
  });

  it('serve hosts the project, and listen shows a trigger a websocket client sends', async () => {
    const served = await startTool(['serve', project, '--port', '18083'], /8083/);
    const page = await fetch('http://localhost:18083/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('cndlpsych/boot.js');
    served.child.kill();

    const listening = await startTool(['listen', '--listen', '18765', '--ack'], /listening on/);
    const socket = new WebSocket('ws://127.0.0.1:18765');
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('no connection')); });
    const reply = new Promise((resolve) => { socket.onmessage = (event) => resolve(JSON.parse(event.data)); });
    socket.send('{"value":3,"event":"input.tap","seq":0}\n');
    expect(await reply).toMatchObject({ ack: true });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    expect(listening.output()).toContain('input.tap');
    socket.close();
  });
});
