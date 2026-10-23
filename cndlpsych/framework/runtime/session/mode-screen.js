// The first screen of a session: live or test mode (see foundation/modes.js). It is not shown when the
// experiment switches it off (`modes.enabled: false`), for a public experiment (participants never choose),
// or when the address already says (`?mode=test`, `?mode=live`).
import { askAction } from '../../authoring/modules/survey.js';
import { createMode, modeFromSearch, resolveModes } from '../../foundation/modes.js';

const trialsText = (settings) => {
  const blocks = Object.entries(settings.block_trials ?? {}).map(([id, n]) => `${id}: ${n}`);
  if (!settings.trials_per_block && !blocks.length) return 'every trial';
  return `at most ${settings.trials_per_block ?? 'all'} trials in each block${blocks.length ? ` (${blocks.join(', ')})` : ''}`;
};

/** What each choice means, from this experiment's own settings. */
const describe = (name, settings, firebase) => (name === 'test'
  ? `**Test**: ${trialsText(settings)}; the participant ID (${settings.subject_id ?? 'free'}) is not kept${firebase ? ' and nothing is sent to Firebase' : ''}; the session is marked as a test.`
  : `**Live**: ${trialsText(settings)}; participant IDs are kept${firebase ? ' and the data is sent to Firebase' : ''}.`);

/**
 * @param {{run: {project: {plan: object}, screen: object}, search?: string}} options
 * @returns {Promise<ReturnType<typeof createMode>>}
 */
export async function chooseMode({ run, search = '' }) {
  const { plan } = run.project;
  const firebase = plan.storage?.firebase?.enabled === true;
  const modes = resolveModes(plan.modes, { publicAccess: firebase && plan.storage.firebase.access === 'public' });
  const asked = modeFromSearch(search);
  let name = asked ?? modes.default;
  if (!asked && modes.enabled) {
    name = await askAction(run.screen, {
      message: `## ${plan.name}\n\nWhich mode do you want to run?\n\n- ${describe('live', modes.settings('live'), firebase)}\n- ${describe('test', modes.settings('test'), firebase)}`,
      choices: [{ value: 'live', text: 'Live' }, { value: 'test', text: 'Test' }],
      defaultValue: modes.default,
    });
  }
  return createMode(name, modes.settings(name));
}
