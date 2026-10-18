// The webcam recording step of a session: tell the participant, ask for the camera, start recording,
// and end the session when the camera is required and cannot be used. The recording itself is in
// ../../pipeline/webcam.js; the pieces go to the session's store.
import { askAction } from '../../authoring/modules/survey.js';
import { createWebcam } from '../../pipeline/webcam.js';
import { showMessage } from './messages.js';

/** Does the webcam recording run for this device profile? (No `profiles` list means every device.) */
export const webcamApplies = (plan, profile) => plan.webcam?.enabled === true && (plan.webcam.profiles === undefined || plan.webcam.profiles.includes(profile));

const intro = (audio) => `## Camera recording

This experiment records video${audio ? ' and sound' : ''} of you with your device's camera, for the whole session. The recording is stored with your other data and given to the experimenter.

Choose *Start*, then allow the camera${audio ? ' and microphone' : ''} when your browser asks.`;
const NEEDED = 'This experiment needs to record with your camera, and it could not be used. The session was stopped. Please tell the experimenter.';

/**
 * Start the webcam recording, if this experiment and device have one. `held.webcam` is set so that
 * the record can carry the summary. If the camera is required and fails, the session ends as aborted.
 * @returns {Promise<{webcam?: object, result?: object}>} `result` is the finished session when it was aborted
 */
export async function prepareWebcam({ run, store, profile, finish, held }) {
  const { services, project, screen } = run;
  const { plan } = project;
  if (!webcamApplies(plan, profile)) return {};
  const { bus, clock, display, sinkSet } = services;
  const firstSegment = (await store.nextSegment?.()) ?? 1;
  const webcam = createWebcam({ bus, clock, config: plan.webcam, saveChunk: (piece) => store.addMedia(piece), firstSegment });
  held.webcam = webcam;
  services.input.onLeave(() => webcam.flush());

  await askAction(screen, { message: intro(webcam.settings.audio), choices: [{ value: 'go', text: 'Start' }], submitLabel: 'Continue' });
  const started = await webcam.start();
  if (started.ok || webcam.settings.on_denied === 'continue_without') return { webcam };

  bus.emit({ source: 'system', type: 'session.end', data: { reason: 'aborted' } });
  const record = await finish('aborted');
  await sinkSet.closeAll();
  showMessage(display, NEEDED);
  return { result: { status: 'aborted', record } };
}

/** The eye tracking step's handle, with the webcam stopped together with it (and before the session ends in the log). */
export const alongsideWebcam = (eye, webcam) => (webcam
  ? { ...eye, settle: () => webcam.stop(), stop: async () => { await webcam.stop(); await eye.stop(); } }
  : eye);
