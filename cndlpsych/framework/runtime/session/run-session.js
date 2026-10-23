// The session lifecycle (ARCHITECTURE.md section 8). This is the entry: it decides between the
// local data screen, resuming an earlier session, and starting a new one. The work is in this folder:
//
//   earlier-sessions.js   the ?manage=1 screen and the offer to resume an interrupted session
//   new-session.js        consent -> forms -> device check -> start recording -> blocks -> finish
//   resume-session.js     carry on an interrupted session
//   conduct-session.js    what both share: run the blocks, then end the session
//   run-blocks.js, finish.js, recording.js, session-record.js, eye-tracking-step.js, ...
import { readEnvironment } from '../../foundation/device.js';
import { experimenterPresent } from './continue-without.js';
import { chooseEarlierSession } from './earlier-sessions.js';
import { runNewSession } from './new-session.js';
import { measureRefresh } from './refresh.js';
import { resumeSession } from './resume-session.js';

/**
 * @param {{services: object, project: {plan: object, consentText?: string, specHash: string, customModules: object[]}, store: object, remote?: object|null, loadGazeEngine?: Function, search?: string}} options
 *   `remote` is the Firebase side (runtime/remote.js), present when `storage.firebase` is enabled;
 *   `loadGazeEngine` replaces the eye tracking engine (tests); `?manage=1` in `search` opens the local data screen instead of starting a session
 * @returns {Promise<{status: string, record?: object}>}
 */
export async function runSession({ services, project, store, remote = null, loadGazeEngine, search = globalThis.location?.search ?? '' }) {
  const { plan } = project;
  /** What every step of this page run shares. */
  const run = {
    services,
    project,
    store,
    remote,
    loadEngine: loadGazeEngine,
    screen: { jsPsych: services.jsPsych },
    env: readEnvironment(globalThis),
    experimenter: experimenterPresent(plan), // someone is there to choose to go on without a feature that cannot be used
    debug: plan.debug?.enabled ? plan.debug : {},
    refresh: measureRefresh(), // started now, finished long before it is needed
  };

  const earlier = await chooseEarlierSession(run, search);
  if (earlier.ended) return earlier.ended;
  if (earlier.resume) return resumeSession(run, earlier.resume);
  return runNewSession(run, search);
}
