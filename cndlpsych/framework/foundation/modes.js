// Live and test mode. An experiment is run in one of two modes, chosen on the first screen:
//  - live: the real thing. Participant numbers are kept (in Firebase when it is on) and every trial runs.
//  - test: to try the experiment out. A shorter run (at most `trials_per_block` trials in each block, or the
//    number given for a block), a throwaway participant ID that is not claimed or sent anywhere, and the
//    session is marked as a test in its record, so it is not taken for data.
// The numbers are configured in experiment.yaml under `modes`; this module only reads them.

export const MODE_NAMES = ['live', 'test'];

/** What test mode does when experiment.yaml says nothing. */
export const TEST_DEFAULTS = { trials_per_block: 3, subject_id: 'sub-test' };

/**
 * @param {object} [modes] `modes` of experiment.yaml
 * @param {{publicAccess?: boolean}} [options] a public experiment (participants open a link) never asks which mode: it is live
 * @returns {{enabled: boolean, default: 'live'|'test', settings: (name: string) => object}}
 */
export function resolveModes(modes = {}, { publicAccess = false } = {}) {
  const defaults = { live: {}, test: TEST_DEFAULTS };
  return {
    enabled: modes.enabled !== false && !publicAccess,
    default: modes.default ?? 'live',
    settings: (name) => ({ ...defaults[name], ...modes[name] }),
  };
}

/** The mode asked for in the address (`?mode=test`), or null. */
export function modeFromSearch(search = '') {
  const value = new URLSearchParams(search).get('mode');
  return MODE_NAMES.includes(value) ? value : null;
}

/**
 * The mode of a session.
 * @param {string} name live or test
 * @param {object} settings that mode's settings from resolveModes
 * @returns {{name: string, test: boolean, subjectId?: string, trialLimit: (blockId: string) => number|null}}
 */
export function createMode(name, settings = {}) {
  return {
    name,
    test: name === 'test',
    ...(settings.subject_id ? { subjectId: settings.subject_id } : {}),
    /** At most this many trials in the block (null: all of them). A number for the block wins over the one for every block. */
    trialLimit: (blockId) => settings.block_trials?.[blockId] ?? settings.trials_per_block ?? null,
  };
}
