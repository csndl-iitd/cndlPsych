// Which device profile the session runs as. A pure decision plus, with `device.select: prompt`,
// one question to the participant; the events that record it are written later.
import { resolveProfile } from '../../foundation/device.js';
import { showForm } from '../../authoring/modules/survey.js';

/** Resolve the device profile; `select: prompt` asks the participant first. */
export async function chooseProfile(screen, plan, env, override) {
  const resolved = resolveProfile(plan.device ?? {}, { env, override });
  if (!resolved.pending) return resolved;
  const options = (plan.device?.allowed ?? ['desktop', 'phone', 'tablet']).map((id) => ({ value: id, text: id }));
  const { values } = await showForm(screen, { title: 'Which device are you using?', elements: [{ type: 'radiogroup', name: 'profile', title: 'Device', isRequired: true, choices: options }] });
  return resolveProfile(plan.device ?? {}, { env, chosen: values.profile, override });
}
