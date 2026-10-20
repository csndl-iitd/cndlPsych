// Connecting the trigger sinks before a session (or a resumed session) starts. Serial and USB
// need a click first (the browser's device picker).
import { askAction } from '../../authoring/modules/survey.js';
import { NEEDS_GESTURE } from '../sinks.js';

/**
 * Each sink connects in turn. A required sink that cannot connect blocks the session unless the
 * user retries successfully; an optional one is skipped with a warning.
 * @returns {Promise<{ok: boolean, blocked?: {id: string, error: string}, warnings: {id: string, error: string}[]}>}
 */
export async function connectSinks(screen, sinkSet) {
  const warnings = [];
  for (const config of sinkSet.configs) {
    const outcome = await connectOne(screen, config, sinkSet.sinks.get(config.id));
    if (outcome.blocked) return { ok: false, blocked: outcome.blocked, warnings };
    if (outcome.warning) warnings.push(outcome.warning);
  }
  return { ok: true, warnings };
}

/** @returns {Promise<{blocked?: {id: string, error: string}, warning?: {id: string, error: string}}>} an empty object means connected */
async function connectOne(screen, config, sink) {
  const optional = !sink.required;
  let needsClick = NEEDS_GESTURE.has(config.type);
  for (;;) {
    if (needsClick) {
      const choices = [{ value: 'connect', text: 'Connect' }, ...(optional ? [{ value: 'skip', text: 'Continue without this device' }] : [])];
      const action = await askAction(screen, { message: `## Trigger device

Connect **${config.id}** (${config.type}). Choose *Connect*, then select the device in the browser dialog.`, choices, submitLabel: 'Continue' });
      if (action === 'skip') return { warning: { id: config.id, error: 'skipped by the experimenter' } };
    }
    const result = await sink.connect();
    if (result.ok) return {};
    if (optional) return { warning: { id: config.id, error: result.error } };
    const choice = await askAction(screen, { message: `## Trigger device not connected

Could not connect **${config.id}**: ${result.error}`, choices: [{ value: 'retry', text: 'Try again' }, { value: 'cancel', text: 'Cancel the session' }] });
    if (choice === 'cancel') return { blocked: { id: config.id, error: result.error } };
    needsClick = false;
  }
}
