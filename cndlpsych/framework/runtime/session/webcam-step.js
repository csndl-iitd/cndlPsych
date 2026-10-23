// The webcam recording step of a session: tell the participant, choose where the video goes, ask for
// the camera, start recording, and end the session when recording is required and cannot start.
// The recording itself is in ../../pipeline/webcam.js; the file it is written to is storage/video-file.js.
import { askAction } from '../../authoring/modules/survey.js';
import { pickMime, createWebcam } from '../../pipeline/webcam.js';
import { canPickFile, openVideoSink, pickVideoFile } from '../../storage/video-file.js';
import { askWhenUnavailable } from './continue-without.js';
import { showMessage } from './messages.js';

/** Does the webcam recording run for this device profile? (No `profiles` list means every device.) */
export const webcamApplies = (plan, profile) => plan.webcam?.enabled === true && (plan.webcam.profiles === undefined || plan.webcam.profiles.includes(profile));

const intro = (audio, toFile) => `## Camera recording

This experiment records video${audio ? ' and sound' : ''} of you with your device's camera, for the whole session. ${toFile
    ? 'You will be asked where to save the video file; choose a folder on this computer and keep the name.'
    : 'The recording is kept in this browser and downloaded as a file when the session ends.'}

Choose *Start*, then ${toFile ? 'choose the file and ' : ''}allow the camera${audio ? ' and microphone' : ''} when your browser asks.`;
const NEEDED = 'This experiment needs to record with your camera, and recording could not start. The session was stopped. Please tell the experimenter.';

/** The number of this recording: one more than the highest already in the log (a resumed session has earlier ones). */
async function nextSegment(store) {
  const { events } = await store.snapshot();
  return events.filter((event) => event.type === 'webcam.start').reduce((highest, event) => Math.max(highest, event.data.segment), 0) + 1;
}

/** Where the video goes: a file on disk where the browser can write one and the experiment allows it, otherwise the browser's storage. */
async function chooseTarget({ settings, names, store, win }) {
  const toFile = settings.save !== 'browser' && canPickFile(win);
  if (!toFile) {
    if (settings.save === 'file') return { failure: { code: 'unsupported', message: 'This browser cannot save video to a file. Use Chrome or Edge on a computer.' } };
    return { saveChunk: (piece) => store.addMedia(piece), destination: { save: 'browser' }, close: async () => {} };
  }
  const mime = pickMime(win.MediaRecorder, settings.audio) ?? 'video/webm';
  const extension = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  try {
    const sink = await openVideoSink(await pickVideoFile({ suggestedName: `${names.subject}_${names.session}_webcam${names.segment > 1 ? `-${names.segment}` : ''}.${extension}`, mime, win }));
    return { saveChunk: (piece) => sink.write(piece.blob), destination: { save: 'file', file: sink.name }, close: () => sink.close() };
  } catch (error) {
    const declined = error?.name === 'AbortError';
    return { failure: { code: declined ? 'file_declined' : 'storage_failed', message: declined ? 'No file was chosen for the video.' : `The video file could not be opened: ${error?.message ?? error}` } };
  }
}

/**
 * Start the webcam recording, if this experiment and device have one. `held.webcam` is set so that
 * the record can carry the summary. If recording is required and cannot start, the session ends as aborted.
 * @returns {Promise<{webcam?: {summary: Function, flush: Function, stop: (reason?: string) => Promise<void>}, result?: object}>}
 *   `result` is the finished session when it was aborted
 */
export async function prepareWebcam({ run, store, profile, record, finish, held, win = globalThis }) {
  const { services, project, screen } = run;
  const { plan } = project;
  if (!webcamApplies(plan, profile)) return {};
  const { bus, clock, display, sinkSet } = services;
  const segment = await nextSegment(store);
  const camera = createWebcam({ bus, clock, config: plan.webcam, firstSegment: segment });
  const { settings } = camera;

  // The file picker needs the click that answers this screen, so it is the first thing done after it.
  const first = await askAction(screen, {
    message: intro(settings.audio, settings.save !== 'browser' && canPickFile(win)),
    choices: [{ value: 'go', text: 'Start' }, ...(run.experimenter ? [{ value: 'skip', text: 'Continue without the camera recording' }] : [])],
    submitLabel: 'Continue',
  });
  let target;
  let started = { ok: false, message: 'The experimenter chose to continue without the camera recording.' };
  let continued = first === 'skip'; // the experimenter chose to go on without the recording
  if (continued) bus.emit({ source: 'system', type: 'system.warning', data: { code: 'webcam_skipped', message: started.message } });
  while (!continued) {
    target = await chooseTarget({ settings, names: { subject: record.subject_id, session: record.session_id, segment }, store, win });
    started = target.failure ? camera.fail(target.failure.code, target.failure.message) : await camera.start(target);
    if (started.ok || settings.on_denied === 'continue_without' || !run.experimenter) break;
    await target.close?.().catch(() => {});
    const choice = await askWhenUnavailable(screen, { feature: 'the camera recording', why: started.message });
    if (choice === 'continue') continued = true;
    if (choice !== 'retry') break;
  }

  const recording = {
    summary: () => camera.summary(),
    flush: () => camera.flush(),
    async stop(reason) {
      await camera.stop(reason);
      await target?.close?.().catch((error) => bus.emit({ source: 'system', type: 'webcam.error', data: { code: 'storage_failed', message: `The video file could not be finished: ${error?.message ?? error}` } }));
    },
  };
  held.webcam = recording;
  services.input.onLeave(() => recording.flush());
  if (started.ok || continued || settings.on_denied === 'continue_without') {
    if (!started.ok) await recording.stop();
    return { webcam: started.ok ? recording : undefined };
  }

  await recording.stop();
  bus.emit({ source: 'system', type: 'session.end', data: { reason: 'aborted' } });
  const finished = await finish('aborted');
  await sinkSet.closeAll();
  showMessage(display, NEEDED);
  return { result: { status: 'aborted', record: finished } };
}

/** The eye tracking step's handle, with the webcam stopped together with it (and before the session ends in the log). */
export const alongsideWebcam = (eye, webcam) => (webcam
  ? { ...eye, settle: () => webcam.stop(), stop: async () => { await webcam.stop(); await eye.stop(); } }
  : eye);
