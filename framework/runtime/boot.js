// boot(): the single entry the user's index.html calls. Loads and compiles the project,
// shows compile errors instead of starting when there are any, and runs the session.
import { markdownToHtml } from '../authoring/modules/markdown.js';
import { runSession } from './lifecycle.js';
import { createLocalStore } from '../storage/local.js';
import { createMemoryStore } from './memory-store.js';
import { loadProject } from './project.js';
import { createRemote } from './remote.js';
import { createServices } from './services.js';

function showDiagnostics(root, errors) {
  const items = errors.map((e) => `- **${e.file}${e.path ? `: ${e.path}` : ''}** [${e.code}] ${e.message}`).join('\n');
  root.innerHTML = `<div style="padding:2em;font-family:sans-serif;color:#fff;background:#400;position:fixed;inset:0;overflow:auto">${markdownToHtml(`# This experiment has errors\n\n${items}`)}</div>`;
}

/**
 * @param {{
 *   root: HTMLElement, url?: string, schemas: object, store?: object, styles?: string[],
 *   validate?: Function, patchExperiment?: (doc: object) => void, onReady?: (services: object, store: object) => void,
 *   connectFirebase?: Function, loadGazeEngine?: Function,
 * }} options
 *   `schemas` is the generated spec/schema/*.json by file name (the bundle provides it);
 *   `validate` (dev) checks every emitted event; `patchExperiment` edits experiment.yaml before compiling;
 *   `onReady` receives the services (bus, stage, ...) and the store before the session starts;
 *   `connectFirebase` replaces the real Firebase connection and `loadGazeEngine` the WebGazer engine (tests).
 * @returns {Promise<{status: string, services?: object, store?: object, record?: object, diagnostics: object[]}>}
 */
export async function boot({ root, url = './', schemas, store, styles = [], validate, patchExperiment, onReady, connectFirebase, loadGazeEngine }) {
  const project = await loadProject({ url, schemas, patchExperiment });
  const errors = project.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length || !project.plan) {
    showDiagnostics(root, errors);
    return { status: 'invalid', diagnostics: project.diagnostics };
  }
  const timeScale = project.plan.debug?.enabled ? (project.plan.debug.time_scale ?? 1) : 1;
  const services = createServices({ root, plan: project.plan, generators: project.generators, validate, timeScale, styles });
  const local = project.plan.storage?.local ?? {};
  const chosen = store ?? (local.enabled === false ? createMemoryStore() : createLocalStore({ flushMs: local.flush_ms }));
  onReady?.(services, chosen);
  const firebase = project.plan.storage?.firebase;
  const remote = firebase?.enabled ? createRemote(firebase, connectFirebase ? { connect: connectFirebase } : {}) : null;
  const result = await runSession({ services, project, store: chosen, remote, loadGazeEngine });
  return { ...result, services, store: chosen, diagnostics: project.diagnostics };
}
