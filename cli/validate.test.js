import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXAMPLE_DIR } from '../tools/project-fixture.js';
import { formatDiagnostic, validateProject } from './validate.js';

const CLI = join(import.meta.dirname, 'validate.js');
let copy;
afterEach(() => copy && rmSync(copy, { recursive: true, force: true }));

function exampleCopy() {
  copy = mkdtempSync(join(tmpdir(), 'cndlpsych-'));
  cpSync(EXAMPLE_DIR, copy, { recursive: true });
  return copy;
}

describe('cli validate', () => {
  it('accepts spec/examples, including its custom stimulus generator', async () => {
    const result = await validateProject(EXAMPLE_DIR);
    expect(result.ok).toBe(true);
    expect(result.plan.stimuli.search_array.type).toBe('search_array');
  });

  it('exits 0 for the example and prints a summary', () => {
    const output = execFileSync('node', [CLI, EXAMPLE_DIR], { encoding: 'utf8' });
    expect(output).toMatch(/0 error\(s\), \d+ warning\(s\)/);
  });

  it('exits 1 and prints file, YAML path and message for a broken project', () => {
    const dir = exampleCopy();
    writeFileSync(join(dir, 'timeline.yaml'), 'blocks:\n  - id: a\n    module: response_task\n    config: { trials: [{ name: t, sequence: [nope] }] }\n');
    const run = spawnSync('node', [CLI, dir], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('error [unknown-stimulus] timeline.yaml:blocks[0].config.trials[0].sequence[0]: unknown stimulus "nope"');
  });

  it('reports a missing consent file found through the project assets', async () => {
    const dir = exampleCopy();
    rmSync(join(dir, 'consent.md'));
    const { diagnostics, ok } = await validateProject(dir);
    expect(ok).toBe(false);
    expect(diagnostics.map(formatDiagnostic)).toContain('error [consent-file-missing] experiment.yaml:consent.file: consent file "consent.md" was not found in the project');
  });

  it('reports a custom module that cannot be imported', async () => {
    const dir = exampleCopy();
    mkdirSync(join(dir, 'custom', 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'custom', 'tasks', 'broken.js'), 'export default {;\n');
    const { diagnostics, ok } = await validateProject(dir);
    expect(ok).toBe(false);
    expect(diagnostics.find((d) => d.code === 'custom-import').file).toBe('custom/tasks/broken.js');
  });

  it('validates a custom task manifest read from disk', async () => {
    const dir = exampleCopy();
    mkdirSync(join(dir, 'custom', 'tasks'), { recursive: true });
    writeFileSync(join(dir, 'custom', 'tasks', 'bad.js'), "export default { params: { x: { type: 'bogus' } }, build() {} };\n");
    const { diagnostics } = await validateProject(dir);
    expect(diagnostics.find((d) => d.code === 'manifest')).toMatchObject({ file: 'custom/tasks/bad.js', path: 'params.x.type' });
  });
});
