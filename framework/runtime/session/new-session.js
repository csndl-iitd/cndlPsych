// A new session, from the consent screen to the end:
//   consent -> subject form -> session form -> device check -> blocks -> finish
// Nothing is recorded before the participant is eligible and the device is resolved: the bus drops
// events until recording starts, and the first recorded event is session.start. A declined consent
// or a failed min_age therefore leaves no trace at all. Each step below returns either its result
// or `{ended}` with the final result of the session, when the participant cannot go on.
import { sessionAnswers, sessionElements, subjectAnswers, subjectElements } from '../../authoring/modules/forms.js';
import { showForm } from '../../authoring/modules/survey.js';
import { isoNow } from '../../foundation/clock.js';
import { admitDevice, inputProfiles, profileConditions } from '../../foundation/device.js';
import { createConsentGate, hashText, resolveSeed } from '../../foundation/session.js';
import { assignedSubject, explainRemoteError, mirrored, remoteFailedMessage } from '../remote.js';
import { askConsent } from './consent.js';
import { conductSession } from './conduct-session.js';
import { chooseProfile } from './device-check.js';
import { prepareEyeTracking } from './eye-tracking-step.js';
import { alongsideWebcam, prepareWebcam } from './webcam-step.js';
import { createFinisher, deviceExtras } from './finish.js';
import { showMessage } from './messages.js';
import { connectStore, emitStartNotices, logStorageStatus } from './recording.js';
import { signInRemote } from './remote-sign-in.js';
import { buildSessionRecord } from './session-record.js';
import { connectSinks } from './trigger-devices.js';
import { FRAMEWORK_VERSION } from './version.js';

/** Consent. Controlled-mode experimenters sign in first (the subject ID is prefilled from Firebase); public participants are signed in anonymously only after they agree. */
async function agree(run, gate) {
  const { project, remote, screen, services } = run;
  const { plan } = project;
  const { display } = services;
  const signIn = async () => {
    const failure = await signInRemote(screen, remote);
    if (!failure) return null;
    showMessage(display, remoteFailedMessage(failure));
    return { ended: { status: 'remote_failed' } };
  };
  if (remote?.access === 'controlled') {
    const failed = await signIn();
    if (failed) return failed;
  }
  if (!(await askConsent(screen, plan, project.consentText, gate))) {
    showMessage(display, plan.consent.decline_message ?? 'You chose not to take part. Nothing has been stored. You can close this window.');
    return { ended: { status: 'declined' } };
  }
  const acceptedAt = isoNow();
  if (remote?.access === 'public') {
    const failed = await signIn();
    if (failed) return failed;
  }
  return { acceptedAt };
}

/** The subject form, the age check, and the session form. */
async function askParticipant(run, gate) {
  const { project, remote, screen, services } = run;
  const { forms } = project.plan;
  let assigned;
  try {
    assigned = await assignedSubject(remote);
  } catch (error) {
    showMessage(services.display, remoteFailedMessage(explainRemoteError(error, remote.config)));
    return { ended: { status: 'remote_failed' } };
  }
  const subjectForm = await showForm(screen, { title: forms.subject?.title ?? 'About you', intro: forms.subject?.intro, elements: subjectElements(forms.subject, assigned) });
  const answered = subjectAnswers(subjectForm.values);
  if (!gate.checkAge(answered.subject.age).eligible) {
    showMessage(services.display, project.plan.consent.decline_message ?? 'Sorry, you are not eligible to take part in this study. Nothing has been stored. You can close this window.');
    return { ended: { status: 'ineligible' } };
  }
  const sessionForm = await showForm(screen, { title: forms.session?.title ?? 'Session', intro: forms.session?.intro, elements: sessionElements(forms.session) });
  return { subjectForm, sessionForm, answered, ...sessionAnswers(sessionForm.values) };
}

/** The device profile, and the trigger sinks for a device that will be admitted. */
async function checkDevice(run) {
  const { project, screen, services, env, debug } = run;
  const { plan } = project;
  const { sinkSet } = services;
  const resolved = await chooseProfile(screen, plan, env, debug.simulate_profile);
  const profile = resolved.profile ?? 'unknown';
  const permitted = plan.device?.allowed ?? Object.keys(profileConditions(plan.device ?? {}));
  let sinkWarnings = [];
  if (resolved.profile !== null && permitted.includes(profile) && sinkSet.configs.length) {
    const connected = await connectSinks(screen, sinkSet);
    if (!connected.ok) {
      await sinkSet.closeAll();
      showMessage(services.display, `The required trigger device **${connected.blocked.id}** is not connected, so the session cannot start. Nothing has been stored.`);
      return { ended: { status: 'sink_failed' } };
    }
    sinkWarnings = connected.warnings;
  }
  // An explicit choice (fixed, prompt, override) is respected; on auto, every input source the device has may answer.
  const sources = resolved.reason === 'auto' && resolved.profile !== null ? inputProfiles(env, plan.device, profile) : [profile];
  return { resolved, profile, sources, sinkWarnings };
}

/** The subject number from Firebase, if the session uses it. */
async function claimSubject(run, typedId) {
  const { remote, services } = run;
  if (!remote) return { claim: null };
  try {
    return { claim: await remote.claim(typedId) };
  } catch (error) {
    await services.sinkSet.closeAll();
    showMessage(services.display, `Could not get a subject number: ${explainRemoteError(error, remote.config)}

Nothing has been stored.`);
    return { ended: { status: 'remote_failed' } };
  }
}

/** Open the store, start the bus recording, and write the first events: session.start, the clock anchor. */
function beginRecording({ run, record, sessionStore, seed, profile, sinkWarnings }) {
  const { services, project, debug } = run;
  const { plan } = project;
  const { bus } = services;
  sessionStore.begin(record);
  connectStore({ services, store: sessionStore });
  bus.startRecording();
  bus.emit({ source: 'system', type: 'session.start', data: { experiment: plan.name, spec_version: plan.spec_version, spec_hash: project.specHash, framework_version: FRAMEWORK_VERSION, seed, profile } });
  bus.emit({ source: 'system', type: 'session.clock_anchor', data: { time_origin_ms: record.clock.time_origin_ms, wall_iso: record.clock.wall_iso } });
  logStorageStatus({ bus, store: sessionStore }); // after session.start: the log must begin with it
  emitStartNotices({ bus, debug, sinkSet: services.sinkSet, sinkWarnings });
}

/**
 * @param {object} run what the whole page run shares (see run-session.js)
 * @param {string} search the page's query string (URL parameters to capture)
 * @returns {Promise<{status: string, record?: object}>}
 */
export async function runNewSession(run, search) {
  const { services, project, store, remote, env, debug, refresh } = run;
  const { plan } = project;
  const { bus, display } = services;
  const gate = createConsentGate(plan.consent);

  const consent = await agree(run, gate);
  if (consent.ended) return consent.ended;
  const participant = await askParticipant(run, gate);
  if (participant.ended) return participant.ended;
  const device = await checkDevice(run);
  if (device.ended) return device.ended;
  const claimed = await claimSubject(run, participant.subjectForm.values.subject_id);
  if (claimed.ended) return claimed.ended;

  const { claim } = claimed;
  const { profile, resolved } = device;
  const subjectId = claim?.label ?? participant.answered.subjectId;
  const seed = resolveSeed(plan.seed);
  const textHash = await hashText(project.consentText ?? '');
  const record = buildSessionRecord({
    run,
    ids: { subjectId, sessionId: participant.sessionId },
    answers: { subject: participant.answered.subject, sessionFields: participant.sessionFields },
    gate,
    consent: { textHash, acceptedAt: consent.acceptedAt },
    device: { profile, reason: resolved.reason, inputProfiles: device.sources },
    seed,
    refreshHz: (await refresh)?.hz,
    search,
  });
  const sessionStore = remote
    ? mirrored(store, remote.store({ claim, onProgress: (progress) => store.setRemote?.({ claim_n: claim.n, ...progress }) }))
    : store;
  beginRecording({ run, record, sessionStore, seed, profile, sinkWarnings: device.sinkWarnings });

  const held = { eye: null };
  const finish = createFinisher({ record, store: sessionStore, bus, extras: deviceExtras(held) });
  const admission = admitDevice(bus, plan.device ?? {}, { env, chosen: resolved.reason === 'prompt' ? profile : undefined, override: debug.simulate_profile });
  if (!admission.admitted) {
    const done = await finish('device_rejected');
    showMessage(display, admission.message);
    return { status: 'device_rejected', record: done };
  }

  bus.emit({ source: 'system', type: 'consent.accepted', data: { text_hash: textHash, mode: plan.consent.mode ?? 'on_screen', statements: record.consent.statements } });
  bus.emit({ source: 'system', type: 'form.submitted', data: { form_id: 'subject', duration_ms: participant.subjectForm.durationMs } });
  bus.emit({ source: 'system', type: 'form.submitted', data: { form_id: 'session', duration_ms: participant.sessionForm.durationMs } });
  services.stage.layout(true);

  const answers = {
    subject: { subject_id: subjectId, ...participant.answered.subject },
    session: { session_id: participant.sessionId, ...participant.sessionFields },
    device: { profile },
  };
  const recorded = await prepareWebcam({ run, store: sessionStore, profile, finish, held });
  if (recorded.result) return recorded.result;
  const prepared = await prepareEyeTracking({ run, profile, seed, finish, held });
  if (prepared.result) {
    await recorded.webcam?.stop('error');
    return prepared.result;
  }
  return conductSession({ run, store: sessionStore, profile, inputProfiles: device.sources, seed, answers, resume: null, finish, eye: alongsideWebcam(prepared.eye, recorded.webcam) });
}
