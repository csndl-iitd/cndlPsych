// Browser test entry for whole sessions: boot() with the generated schemas, the survey
// stylesheet, and a dev validator that checks every emitted event against the event schema.
import Ajv from 'ajv';
import surveyCss from '@jspsych/plugin-survey/css/survey.css';
import { loadWebgazer } from '../../framework/pipeline/gaze.js';
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
 * A camera-less stand-in for WebGazer: a cooperative participant who looks at the calibration dot
 * (or the middle of the stage), shifted by `engine.offset`. `window.gazeEngine` lets a test steer it.
 */
function fakeGazeEngine({ fail }) {
  const engine = {
    version: 'fake-1.0', offset: { x: 0, y: 0 }, face: true, recorded: 0, previews: [], ended: false, timer: null,
    async begin({ onSample }) {
      if (fail) throw Object.assign(new Error('Permission denied'), { name: fail });
      engine.timer = setInterval(() => {
        if (!engine.face) { onSample(null); return; }
        const dot = document.querySelector('.cndlpsych-gaze-dot')?.getBoundingClientRect();
        const rect = dot ?? window.sessionServices.stage.rect;
        const centre = dot ? { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 } : { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
        onSample({ x: centre.x + engine.offset.x, y: centre.y + engine.offset.y });
      }, 20);
    },
    record() { engine.recorded += 1; },
    preview(show) { engine.previews.push(show); },
    end() { clearInterval(engine.timer); engine.ended = true; },
  };
  window.gazeEngine = engine;
  return engine;
}

/**
 * @param {{url?: string, merge?: object, local?: boolean, firebase?: {uid: string}, gaze?: 'fake'|'real', gazeFail?: string}} options `merge` is deep-merged into experiment.yaml;
 *   `local: true` uses the project's real storage (IndexedDB) instead of the in-memory test store;
 *   `firebase` runs against the fake Firestore the test exposed as window.fakeFirestore;
 *   `gaze` picks the eye tracking engine: a scripted `fake` (gazeFail = the camera error name) or the `real` WebGazer
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
    loadGazeEngine: options.gaze === 'fake' ? async () => fakeGazeEngine({ fail: options.gazeFail })
      : options.gaze === 'real' ? () => loadWebgazer({ solutionPath: '/node_modules/webgazer/dist/mediapipe/face_mesh' }) : undefined,
    connectFirebase: options.firebase ? fakeConnect({ uid: options.firebase.uid, access: options.firebase.access }) : undefined,
    patchExperiment: (doc) => {
      if (!options.firebase) doc.storage.firebase.enabled = false; // the example enables it; only Firebase tests want it
      merge(doc, options.merge ?? {});
    },
    onReady: (services, store) => { window.sessionServices = services; window.sessionStore = store; },
  }).then((result) => { window.sessionResult = result; return result; });
  return window.sessionPromise;
};
window.cndlpsychStorage = { createLocalStore };
window.sessionReady = true;
