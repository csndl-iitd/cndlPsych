// boot(): the single entry the user's index.html calls. Loads and compiles the project,
// shows compile errors instead of starting when there are any, and runs the session.
import { markdownToHtml } from '../authoring/modules/markdown.js';
import { runSession } from './lifecycle.js';
import { createMemoryStore } from './memory-store.js';
import { loadProject } from './project.js';
import { createServices } from './services.js';

function showDiagnostics(root, errors) {
  const items = errors.map((e) => `- **${e.file}${e.path ? `: ${e.path}` : ''}** [${e.code}] ${e.message}`).join('\n');
  root.innerHTML = `<div style="padding:2em;font-family:sans-serif;color:#fff;background:#400;position:fixed;inset:0;overflow:auto">${markdownToHtml(`# This experiment has errors\n\n${items}`)}</div>`;
}

/**
 * @param {{
 *   root: HTMLElement, url?: string, schemas: object, store?: object, styles?: string[],
 *   validate?: Function, patchExperiment?: (doc: object) => void, onReady?: (services: object) => void,
 * }} options
 *   `schemas` is the generated spec/schema/*.json by file name (the bundle provides it);
 *   `validate` (dev) checks every emitted event; `patchExperiment` edits experiment.yaml before compiling;
 *   `onReady` receives the services (bus, stage, ...) before the session starts.
 * @returns {Promise<{status: string, services?: object, store?: object, record?: object, diagnostics: object[]}>}
 */
export async function boot({ root, url = './', schemas, store = createMemoryStore(), styles = [], validate, patchExperiment, onReady }) {
  const project = await loadProject({ url, schemas, patchExperiment });
  const errors = project.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length || !project.plan) {
    showDiagnostics(root, errors);
    return { status: 'invalid', diagnostics: project.diagnostics };
  }
  const timeScale = project.plan.debug?.enabled ? (project.plan.debug.time_scale ?? 1) : 1;
  const services = createServices({ root, plan: project.plan, generators: project.generators, validate, timeScale, styles });
  onReady?.(services);
  const result = await runSession({ services, project, store });
  return { ...result, services, store, diagnostics: project.diagnostics };
}
