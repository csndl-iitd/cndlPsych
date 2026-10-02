// Run the official bids-validator (the Deno implementation, from JSR) on a dataset folder and
// summarise its issues. Deno itself comes from the npm `deno` package, installed under
// .tools/validator (git-ignored) on first use.
//
//   node tools/bids-validate.js <dataset-dir> [--json]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HOME = join(import.meta.dirname, '..', '.tools', 'validator');
const DENO = join(HOME, 'node_modules', 'deno', 'bin.cjs');

function ensureDeno() {
  if (existsSync(DENO)) return;
  mkdirSync(HOME, { recursive: true });
  writeFileSync(join(HOME, 'package.json'), '{"private":true}\n');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', 'deno'], { cwd: HOME, stdio: 'inherit', shell: true });
}

/**
 * @returns {{version: string, errors: object[], warnings: object[], raw: object}}
 */
export function validateBids(dataset) {
  ensureDeno();
  // Deno switches to node_modules mode inside a folder that has a package.json, which breaks JSR
  // imports, so it runs from a neutral folder.
  const run = spawnSync(process.execPath, [DENO, 'run', '-A', 'jsr:@bids/validator', resolve(dataset), '--format', 'json', '--max-rows', '-1'], { cwd: tmpdir(), encoding: 'utf8', maxBuffer: 1 << 28 });
  const start = run.stdout.indexOf('{');
  if (start < 0) throw new Error(`bids-validator produced no JSON:\n${run.stdout}\n${run.stderr}`);
  const raw = JSON.parse(run.stdout.slice(start));
  const issues = raw.issues.issues;
  return { version: `${raw.summary.schemaVersion} (BIDS schema)`, errors: issues.filter((i) => i.severity === 'error'), warnings: issues.filter((i) => i.severity === 'warning'), raw };
}

const label = (issue) => `${issue.code}${issue.subCode ? `:${issue.subCode}` : ''}`;
export function summarise(result) {
  const lines = [];
  for (const [name, list] of [['error', result.errors], ['warning', result.warnings]]) {
    const groups = Map.groupBy(list, label);
    for (const [code, items] of groups) lines.push(`${name} ${code} x${items.length}  e.g. ${items[0].location ?? ''}`);
  }
  return lines;
}

if (process.argv[1] === import.meta.filename) {
  const [dir] = process.argv.slice(2);
  if (!dir) throw new Error('usage: node tools/bids-validate.js <dataset-dir>');
  const result = validateBids(dir);
  console.log(`bids-validator ${result.version}: ${result.errors.length} errors, ${result.warnings.length} warnings`);
  console.log(summarise(result).join('\n'));
  process.exitCode = result.errors.length ? 1 : 0;
}
