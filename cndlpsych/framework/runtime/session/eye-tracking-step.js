// The eye tracking step of a session, as the session flow sees it: set it up once the participant
// is admitted, and end the session if it cannot go on. (Its summary is added to the record at the end
// by finish.js.)
// The camera, calibration and validation themselves are in ../eyetracking.js.
import { createRng } from '../../foundation/rng.js';
import { setupEyeTracking } from '../eyetracking.js';
import { showMessage } from './messages.js';

const STOPPED = {
  validation_failed: 'The session was stopped because eye tracking could not be made accurate enough. Please tell the experimenter.',
  no_addon: 'Eye tracking is switched on for this experiment, but its software is not installed on this website. Please tell the experimenter.',
};
const CAMERA_STOPPED = 'This experiment needs your camera for eye tracking, and it could not be used. Please tell the experimenter.';

/**
 * Set up eye tracking (camera, calibration, validation). If it cannot go on, the session ends as aborted.
 * `held.eye` is set so that the record can carry the summary.
 * @returns {Promise<{eye?: object, result?: object}>} `result` is the finished session when it was aborted
 */
export async function prepareEyeTracking({ run, profile, seed, finish, held }) {
  const { services, project, screen, loadEngine } = run;
  const eye = await setupEyeTracking({ services, screen, plan: project.plan, profile, rng: createRng(seed), loadEngine });
  held.eye = eye;
  if (eye.status !== 'aborted') return { eye };
  const { bus, display, sinkSet } = services;
  bus.emit({ source: 'system', type: 'session.end', data: { reason: 'aborted' } });
  await eye.stop();
  const record = await finish('aborted');
  await sinkSet.closeAll();
  showMessage(display, STOPPED[eye.reason] ?? CAMERA_STOPPED);
  return { result: { status: 'aborted', record } };
}
