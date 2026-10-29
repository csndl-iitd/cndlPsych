// Connecting the trigger sinks before a session (or a resumed session) starts. Serial and USB
// need a click first (the browser's device picker).
import { askAction } from '../../authoring/modules/survey.js';
import { NEEDS_GESTURE } from '../sinks.js';

/**
 * Each sink connects in turn. A required sink that cannot connect blocks the session unless the
 * user retries successfully or, when an experimenter is present, goes on without it; an optional one is skipped
 * with a warning.
 * @param {{experimenter?: boolean}} [options]
 * @returns {Promise<{ok: boolean, blocked?: {id: string, error: string}, warnings: {id: string, error: string}[]}>}
 */
export async function connectSinks(screen, sinkSet, { experimenter = false } = {}) {
  const warnings = [];
  for (const config of sinkSet.configs) {
    const outcome = await connectOne(screen, config, sinkSet.sinks.get(config.id), experimenter);
    if (outcome.skipped) await sinkSet.skip(config.id); // the experimenter went on without it
    if (outcome.blocked) return { ok: false, blocked: outcome.blocked, warnings };
    if (outcome.warning) warnings.push(outcome.warning);
  }
  return { ok: true, warnings };
}

/** @returns {Promise<{blocked?: {id: string, error: string}, warning?: {id: string, error: string}}>} an empty object means connected */
async function connectOne(screen, config, sink, experimenter) {
  const optional = !sink.required;
  const canSkip = optional || experimenter;
  let needsClick = NEEDS_GESTURE.has(config.type);
  for (;;) {
    if (needsClick) {
      const choices = [{ value: 'connect', text: 'Connect' }, ...(canSkip ? [{ value: 'skip', text: 'Continue without this device' }] : [])];
      const action = await askAction(screen, { message: `## Trigger device

Connect **${config.id}** (${config.type}). Choose *Connect*, then select the device in the browser dialog.`, choices, submitLabel: 'Continue' });
      if (action === 'skip') return { warning: { id: config.id, error: 'skipped by the experimenter' }, skipped: true };
    }
    const result = await sink.connect();
    if (result.ok) return {};
    if (optional) return { warning: { id: config.id, error: result.error } };
    const choice = await askAction(screen, { message: `## Trigger device not connected

Could not connect **${config.id}**: ${result.error}`, choices: [{ value: 'retry', text: 'Try again' }, ...(experimenter ? [{ value: 'skip', text: 'Continue without this device' }] : []), { value: 'cancel', text: 'Cancel the session' }] });
    if (choice === 'skip') return { warning: { id: config.id, error: `skipped by the experimenter (${result.error})` }, skipped: true };
    if (choice === 'cancel') return { blocked: { id: config.id, error: result.error } };
    needsClick = false;
  }
}
