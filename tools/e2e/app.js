// Browser test app (bundled by tools/build-e2e.js): the real framework modules, real
// unmodified jsPsych and its html-keyboard-response plugin, and a dev-mode validator that
// checks every emitted event against the generated event schema.
import Ajv from 'ajv';
import { initJsPsych } from 'jspsych';
import htmlKeyboardResponse from '@jspsych/plugin-html-keyboard-response';
import eventSchema from '../../spec/schema/event.schema.json';
import { createClock } from '../../framework/foundation/clock.js';
import { createBus } from '../../framework/foundation/events.js';
import { createBridge } from '../../framework/pipeline/bridge.js';
import { createInput } from '../../framework/pipeline/input.js';
import { createMapping } from '../../framework/pipeline/mapping.js';
import { createCursor } from '../../framework/stage/cursor.js';
import { createStage } from '../../framework/stage/stage.js';

const validateEvent = new Ajv({ strict: false, allErrors: true }).compile(eventSchema);
const problemsOf = (event) => (validateEvent(event) ? [] : validateEvent.errors.map((e) => `${e.instancePath} ${e.message}`));

/**
 * @param {{stageSpec?: object, scope?: object, profile?: string, withJsPsych?: boolean}} options
 */
function createApp({ stageSpec = {}, scope = { intents: {}, rules: [] }, profile = 'desktop', withJsPsych = false } = {}) {
  const bus = createBus({ clock: createClock(), validate: problemsOf });
  const events = [];
  const problems = [];
  bus.on('*', (event) => events.push(event));

  const root = document.createElement('div');
  document.body.append(root);
  const stage = createStage({ root, bus, spec: stageSpec });
  const input = createInput({ bus, stage });
  const cursor = createCursor({ element: root });
  input.onActivity((move) => cursor.moved(move));

  const bridge = createBridge({ bus });
  const mapping = createMapping({ bus, hooks: { applyEffect: (effect, refs) => stage.applyEffect(effect, refs) } });
  mapping.setScope(scope, profile, { toPx: (length) => stage.lengthToPx(length) });
  input.setConsumer((candidate) => mapping.wouldConsume(candidate));
  input.configure(scope);
  cursor.configure(scope.cursor);
  const keys = bridge.setIntents(scope.intents);

  let jsPsych = null;
  if (withJsPsych) {
    const display = document.createElement('div');
    stage.element.append(display);
    jsPsych = initJsPsych({ display_element: display, extensions: [{ type: bridge.Extension }] });
  }

  /** Run one html-keyboard-response trial that accepts the given intents; resolves with its data. */
  async function runTrial(accepted, { stimulus = '<p>trial</p>' } = {}) {
    mapping.setAccepted(accepted);
    const choices = accepted.includes('any') ? 'ALL_KEYS' : bridge.keysFor(accepted);
    await jsPsych.run([{ type: htmlKeyboardResponse, stimulus, choices, extensions: [{ type: bridge.Extension, params: { accepted } }] }]);
    return jsPsych.data.get().last(1).values()[0];
  }

  function addTarget({ id, role, left, top, width = 80, height = 80 }) {
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, background: '#468' });
    if (id !== undefined) el.dataset.id = String(id);
    if (role !== undefined) el.dataset.role = role;
    stage.element.append(el);
    return el;
  }

  return { bus, events, problems, root, stage, input, cursor, mapping, bridge, keys, jsPsych, runTrial, addTarget };
}

window.cndlpsych = { createApp };
window.appReady = true;
