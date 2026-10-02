// Browser test entry for whole sessions: boot() with the generated schemas, the survey
// stylesheet, and a dev validator that checks every emitted event against the event schema.
import Ajv from 'ajv';
import surveyCss from '@jspsych/plugin-survey/css/survey.css';
import { boot } from '../../framework/runtime/boot.js';
import { createMemoryStore } from '../../framework/runtime/memory-store.js';
import { createLocalStore } from '../../framework/storage/local.js';
import { schemas } from './schemas.js';

const validateEvent = new Ajv({ strict: false, allErrors: true }).compile(schemas['event.schema.json']);
const problemsOf = (event) => (validateEvent(event) ? [] : validateEvent.errors.map((e) => `${e.instancePath} ${e.message}`));

function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') merge(target[key], value);
    else target[key] = value;
  }
}

/** A Firebase connection whose operations are answered by the test process (tools/e2e/fake-firestore.js). */
function fakeConnect({ uid, access }) {
  const call = async (op, ...args) => {
    const { value, error } = await window.fakeFirestore(op, args);
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return value;
  };
  const names = ['claimExists', 'markerNumber', 'listClaimNumbers', 'createPublicClaim', 'createClaim', 'setClaimStatus', 'createSession', 'updateSession', 'putChunk'];
  return async () => {
    await call('signIn');
    return { uid, access, width: 3, ops: Object.fromEntries(names.map((name) => [name, (...args) => call(name, ...args)])) };
  };
}

/**
 * @param {{url?: string, merge?: object, local?: boolean, firebase?: {uid: string}}} options `merge` is deep-merged into experiment.yaml;
 *   `local: true` uses the project's real storage (IndexedDB) instead of the in-memory test store;
 *   `firebase` runs against the fake Firestore the test exposed as window.fakeFirestore
 */
window.runSession = (options = {}) => {
  const root = document.createElement('div');
  document.body.append(root);
  window.sessionRoot = root;
  window.sessionStore = options.local ? undefined : createMemoryStore();
  window.sessionPromise = boot({
    root,
    store: window.sessionStore,
    url: options.url ?? '/spec/examples/',
    schemas,
    styles: [surveyCss],
    validate: problemsOf,
    connectFirebase: options.firebase ? fakeConnect({ uid: options.firebase.uid, access: options.firebase.access }) : undefined,
    patchExperiment: (doc) => {
      if (!options.firebase) doc.storage.firebase.enabled = false; // the example enables it; only Firebase tests want it
      merge(doc, options.merge ?? {});
    },
    onReady: (services, store) => { window.sessionServices = services; window.sessionStore = store; },
  }).then((result) => { window.sessionResult = result; return result; });
  return window.sessionPromise;
};
window.expfwStorage = { createLocalStore };
window.sessionReady = true;
