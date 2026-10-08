// Carrying on an interrupted session: same participant, seed and device kind, new page clock.
// The log continues at last_seq + 1 with a session.clock_anchor and a session.resume event.
import { isoNow } from '../../foundation/clock.js';
import { mirrored, remoteFailedMessage } from '../remote.js';
import { checkResumable, resumedRecord } from '../resume.js';
import { conductSession } from './conduct-session.js';
import { prepareEyeTracking } from './eye-tracking-step.js';
import { createFinisher, eyeExtras } from './finish.js';
import { showMessage } from './messages.js';
import { connectStore, emitStartNotices, logStorageStatus } from './recording.js';
import { signInRemote } from './remote-sign-in.js';
import { sinkRecord } from './session-record.js';
import { connectSinks } from './trigger-devices.js';
import { FRAMEWORK_VERSION } from './version.js';

/** Read the saved session and decide whether it can be resumed here and now. */
async function loadSaved(run, item) {
  const { project, store, env, debug } = run;
  const saved = await store.read(item.key);
  const verdict = saved
    ? checkResumable({ record: saved.record, events: saved.events, plan: project.plan, specHash: project.specHash, env, override: debug.simulate_profile })
    : { ok: false, reason: 'The saved session could not be read.' };
  return { saved, verdict };
}

/** The trigger sinks the session used must connect again; a refused one leaves the saved data unchanged. */
async function reconnectSinks(run) {
  const { screen, services } = run;
  const { sinkSet, display } = services;
  if (!sinkSet.configs.length) return { sinkWarnings: [] };
  const connected = await connectSinks(screen, sinkSet);
  if (connected.ok) return { sinkWarnings: connected.warnings };
  await sinkSet.closeAll();
  showMessage(display, `The required trigger device **${connected.blocked.id}** is not connected, so the session cannot be resumed. The saved data is unchanged.`);
  return { ended: { status: 'sink_failed' } };
}

/** If the session was being mirrored to Firebase, sign in again; otherwise it stays local. */
async function reconnectRemote(run, saved) {
  const { remote, screen, services } = run;
  const mirrorable = Boolean(remote) && saved.remote?.claim_n !== undefined;
  if (!mirrorable) return { mirrorable };
  const failure = await signInRemote(screen, remote);
  if (!failure) return { mirrorable };
  await services.sinkSet.closeAll();
  showMessage(services.display, `${remoteFailedMessage(failure)} The saved data is unchanged.`);
  return { ended: { status: 'remote_failed' } };
}

/**
 * @param {object} run what the whole page run shares (see run-session.js)
 * @param {{key: string}} item the stored session to resume
 * @returns {Promise<{status: string, record?: object}>}
 */
export async function resumeSession(run, item) {
  const { services, project, store: local, remote, debug } = run;
  const { plan } = project;
  const { bus, clock, display } = services;

  const { saved, verdict } = await loadSaved(run, item);
  if (!verdict.ok) {
    showMessage(display, `This session cannot be resumed: ${verdict.reason}`);
    return { status: 'not_resumable' };
  }
  const sinks = await reconnectSinks(run);
  if (sinks.ended) return sinks.ended;
  const mirror = await reconnectRemote(run, saved);
  if (mirror.ended) return mirror.ended;

  const lastSeq = saved.events.at(-1).seq;
  const anchor = clock.anchor();
  const record = resumedRecord(saved.record, { lastSeq, anchor, resumedAt: isoNow(), point: verdict.point, plan, frameworkVersion: FRAMEWORK_VERSION, sinks: sinkRecord(services.sinkSet, mirror.mirrorable ? remote : null) });
  await local.resume(item.key, record);
  let store = local;
  if (mirror.mirrorable) {
    const claimNumber = saved.remote.claim_n;
    const remoteStore = remote.store({ claim: { n: claimNumber }, onProgress: (progress) => local.setRemote({ claim_n: claimNumber, ...progress }) });
    remoteStore.resume(record, saved.remote, saved.events);
    store = mirrored(local, remoteStore);
  }

  connectStore({ services, store });
  bus.startRecording({ fromSeq: lastSeq + 1 });
  const entry = record.resumes.at(-1);
  bus.emit({ source: 'system', type: 'session.clock_anchor', data: { time_origin_ms: anchor.time_origin_ms, wall_iso: anchor.wall_iso } });
  bus.emit({ source: 'system', type: 'session.resume', data: { from_seq: lastSeq, time_origin_ms: anchor.time_origin_ms, wall_iso: anchor.wall_iso, block_id: entry.block_id, trial: entry.trial } });
  logStorageStatus({ bus, store });
  emitStartNotices({ bus, debug, sinkSet: services.sinkSet, sinkWarnings: sinks.sinkWarnings });
  services.stage.layout(true);

  const profile = record.device.profile;
  const answers = {
    subject: { subject_id: record.subject_id, ...record.subject },
    session: { session_id: record.session_id, ...record.session_fields },
    device: { profile },
  };
  const held = { eye: null };
  const finish = createFinisher({ record, store, bus, extras: eyeExtras(held) });
  const seed = record.experiment.seed;
  const prepared = await prepareEyeTracking({ run, profile, seed, finish, held });
  if (prepared.result) return prepared.result;
  return conductSession({ run, store, profile, seed, answers, resume: verdict.point, finish, eye: prepared.eye });
}
