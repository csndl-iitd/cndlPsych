// Usage: node cli/validate.js <project-dir>
// Compiles the project and prints every diagnostic; exits 1 if there are errors.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../framework/authoring/compiler.js';
import { loadProject } from './project.js';

export async function validateProject(dir, options) {
  const { project, loadProblems } = await loadProject(dir, options);
  const result = compile(project);
  const problems = loadProblems.map(({ file, message }) => ({
    severity: 'error', code: 'custom-import', file, path: '', message: `could not load: ${message}`,
  }));
  const diagnostics = [...problems, ...result.diagnostics];
  const ok = !diagnostics.some((d) => d.severity === 'error');
  return { ...result, diagnostics, ok };
}

export function formatDiagnostic({ severity, code, file, path, message }) {
  return `${severity} [${code}] ${file}${path ? `:${path}` : ''}: ${message}`;
}

async function main() {
  const dir = resolve(process.argv[2] ?? '.');
  const { diagnostics, ok } = await validateProject(dir);
  for (const diagnostic of diagnostics) console.log(formatDiagnostic(diagnostic));
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  console.log(`${errors} error(s), ${diagnostics.length - errors} warning(s)`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
