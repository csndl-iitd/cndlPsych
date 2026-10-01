// Browser test entry for whole sessions: boot() with the generated schemas, the survey
// stylesheet, and a dev validator that checks every emitted event against the event schema.
import Ajv from 'ajv';
import surveyCss from '@jspsych/plugin-survey/css/survey.css';
import { boot } from '../../framework/runtime/boot.js';
import { createMemoryStore } from '../../framework/runtime/memory-store.js';
import { schemas } from './schemas.js';

const validateEvent = new Ajv({ strict: false, allErrors: true }).compile(schemas['event.schema.json']);
const problemsOf = (event) => (validateEvent(event) ? [] : validateEvent.errors.map((e) => `${e.instancePath} ${e.message}`));

function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') merge(target[key], value);
    else target[key] = value;
  }
}

/** @param {{url?: string, merge?: object}} options `merge` is deep-merged into experiment.yaml */
window.runSession = (options = {}) => {
  const root = document.createElement('div');
  document.body.append(root);
  window.sessionRoot = root;
  window.sessionStore = createMemoryStore();
  window.sessionPromise = boot({
    root,
    store: window.sessionStore,
    url: options.url ?? '/spec/examples/',
    schemas,
    styles: [surveyCss],
    validate: problemsOf,
    patchExperiment: (doc) => merge(doc, options.merge ?? {}),
    onReady: (services) => { window.sessionServices = services; },
  }).then((result) => { window.sessionResult = result; return result; });
  return window.sessionPromise;
};
window.sessionReady = true;
