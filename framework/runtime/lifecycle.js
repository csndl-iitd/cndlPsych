// The session lifecycle (ARCHITECTURE.md section 8):
//   consent -> subject form -> session form -> device check -> blocks -> finish
// Nothing is recorded before the participant is eligible and the device is resolved: the
// bus drops events until startRecording(), and the first recorded event is session.start.
// A declined consent or a failed min_age therefore leaves no trace at all.
import { buildInstructions } from '../authoring/modules/instructions.js';
import { sessionAnswers, sessionElements, subjectAnswers, subjectElements } from '../authoring/modules/forms.js';
import { markdownToHtml } from '../authoring/modules/markdown.js';
import { runNodes } from '../authoring/modules/jspsych.js';
import { buildResponseTask } from '../authoring/modules/response-task.js';
import { askAction, buildSurvey, showConsent, showForm } from '../authoring/modules/survey.js';
import { admitDevice, deviceRecord, profileConditions, readEnvironment, resolveProfile } from '../foundation/device.js';
import { matchesPredicate } from '../foundation/matcher.js';
import { createRng } from '../foundation/rng.js';
import { sessionArchive, SUPPORTED_FORMATS } from '../storage/export.js';
import { downloadFile } from './download.js';
import { recoverSessions } from './recovery.js';
import { NEEDS_GESTURE } from './sinks.js';
import { createConsentGate, createSessionRecord, finishSessionRecord, hashText, parseUrlParams, resolveSeed } from '../foundation/session.js';

export const FRAMEWORK_VERSION = '0.1.0';

const BUILDERS = { response_task: buildResponseTask, instructions: buildInstructions, survey: buildSurvey };

function showMessage(display, markdown) {
  display.innerHTML = `<div class="expfw-message" style="max-width:40em;padding:2em;text-align:center;line-height:1.5">${markdownToHtml(markdown)}</div>`;
}

const isoNow = () => new Date().toISOString();

async function askConsent(screen, plan, consentText, gate) {
  for (;;) {
    const answer = await showConsent(screen, { markdown: consentText ?? '', mode: plan.consent.mode, statements: plan.consent.statements });
    if (!answer.agreed) {
      gate.decline();
      return false;
    }
    if (gate.accept(answer.statements).ok) return true;
  }
}

/** Resolve the device profile; `select: prompt` asks the participant first. */
async function chooseProfile(screen, plan, env, override) {
  let resolved = resolveProfile(plan.device ?? {}, { env, override });
  if (!resolved.pending) return resolved;
  const options = (plan.device?.allowed ?? ['desktop', 'phone', 'tablet']).map((id) => ({ value: id, text: id }));
  const { values } = await showForm(screen, { title: 'Which device are you using?', elements: [{ type: 'radiogroup', name: 'profile', title: 'Device', isRequired: true, choices: options }] });
  resolved = resolveProfile(plan.device ?? {}, { env, chosen: values.profile, override });
  return resolved;
}

/**
 * "Connect trigger sinks": each sink connects in turn. Serial and USB need a click first (the
 * browser's device picker). A required sink that cannot connect blocks the session unless the
 * user retries successfully; an optional one is skipped with a warning.
 * @returns {Promise<{ok: boolean, blocked?: {id: string, error: string}, warnings: {id: string, error: string}[]}>}
 */
async function connectSinks(screen, sinkSet) {
  const warnings = [];
  for (const config of sinkSet.configs) {
    const sink = sinkSet.sinks.get(config.id);
    const optional = !sink.required;
    let needsClick = NEEDS_GESTURE.has(config.type);
    for (;;) {
      if (needsClick) {
        const choices = [{ value: 'connect', text: 'Connect' }, ...(optional ? [{ value: 'skip', text: 'Continue without this device' }] : [])];
        const action = await askAction(screen, { message: `## Trigger device

Connect **${config.id}** (${config.type}). Choose *Connect*, then select the device in the browser dialog.`, choices, submitLabel: 'Continue' });
        if (action === 'skip') {
          warnings.push({ id: config.id, error: 'skipped by the experimenter' });
          break;
        }
      }
      const result = await sink.connect();
      if (result.ok) break;
      if (optional) {
        warnings.push({ id: config.id, error: result.error });
        break;
      }
      const choice = await askAction(screen, { message: `## Trigger device not connected

Could not connect **${config.id}**: ${result.error}`, choices: [{ value: 'retry', text: 'Try again' }, { value: 'cancel', text: 'Cancel the session' }] });
      if (choice === 'cancel') return { ok: false, blocked: { id: config.id, error: result.error }, warnings };
      needsClick = false;
    }
  }
  return { ok: true, warnings };
}

function blockApplies(planBlock, profile, answers) {
  if (!planBlock.profiles.includes(profile)) return false;
  return planBlock.when === undefined || matchesPredicate(planBlock.when, answers);
}

async function runBlocks({ services, plan, profile, seed, answers }) {
  const { bus, jsPsych } = services;
  const master = createRng(seed);
  let lostSink = null;
  services.onRequiredSinkLost((id) => {
    lostSink = lostSink ?? id;
    jsPsych.abortExperiment('A required trigger device was lost. The session has stopped.');
  });
  for (const planBlock of plan.blocks) {
    if (!blockApplies(planBlock, profile, answers)) {
      bus.emit({ source: 'system', type: 'block.end', block: planBlock.id, data: { block_id: planBlock.id, reason: 'skipped' } });
      continue;
    }
    const build = BUILDERS[planBlock.module];
    if (!build) throw new Error(`module "${planBlock.module}" is not available (custom tasks are not supported yet)`);
    for (let run = 1; run <= planBlock.repeat; run += 1) {
      const ctx = services.moduleContext({ rng: master.fork(`block:${planBlock.id}:${run}`), profile });
      const { nodes, nTrials } = build(ctx, planBlock);
      ctx.applyTriggers(planBlock.triggers);
      bus.setContext({ block: planBlock.id, trial: null, phase: null });
      bus.emit({ source: 'system', type: 'block.start', data: { block_id: planBlock.id, module: planBlock.module, n_trials: nTrials } });
      await runNodes(jsPsych, nodes);
      if (lostSink) throw new Error(`the required trigger sink "${lostSink}" was lost during the session`);
      bus.emit({ source: 'system', type: 'block.end', data: { block_id: planBlock.id, reason: 'complete' } });
      ctx.applyTriggers({ enabled: false, rules: [] });
      bus.setContext({ block: null, trial: null, phase: null });
    }
  }
}

function finishScreen(display, plan, record) {
  const { finish = {} } = plan;
  const code = finish.show_session_code ? `\n\nSession code: **${record.subject_id}_${record.session_id}**` : '';
  showMessage(display, `${finish.message ?? 'Thank you. You can close this window.'}${code}`);
  if (finish.redirect_url) {
    setTimeout(() => globalThis.location.assign(finish.redirect_url), finish.redirect_delay === undefined ? 3000 : Number.parseFloat(finish.redirect_delay) * (String(finish.redirect_delay).endsWith('ms') ? 1 : 1000));
  }
}

/** Download the finished session as one zip, if export_on_finish asks for a format we can write. */
async function exportSession(doc, store, formats) {
  if (!formats.some((format) => SUPPORTED_FORMATS.includes(format))) return;
  const { record, events } = await store.snapshot();
  const archive = sessionArchive(record, events, formats);
  downloadFile(doc, { name: archive.name, data: archive.data });
}

/**
 * @param {{services: object, project: {plan: object, consentText?: string, specHash: string, customModules: object[]}, store: object, search?: string}} options
 * @returns {Promise<{status: string, record?: object}>}
 */
export async function runSession({ services, project, store, search = globalThis.location?.search ?? '' }) {
  const { plan } = project;
  const { bus, clock, display } = services;
  const screen = { jsPsych: services.jsPsych };
  const gate = createConsentGate(plan.consent);
  const local = plan.storage?.local ?? {};
  const exportFormats = local.export_on_finish ?? [];

  // 0. interrupted sessions from earlier (before anything about this participant exists)
  await recoverSessions({ screen, store, policy: local.recovery ?? 'offer', formats: exportFormats, doc: display.ownerDocument });

  // 1. consent (nothing is recorded: the bus is not recording yet)
  if (!(await askConsent(screen, plan, project.consentText, gate))) {
    showMessage(display, plan.consent.decline_message ?? 'You chose not to take part. Nothing has been stored. You can close this window.');
    return { status: 'declined' };
  }
  const acceptedAt = isoNow();

  // 2. subject and session forms
  const subjectForm = await showForm(screen, { title: plan.forms.subject?.title ?? 'About you', intro: plan.forms.subject?.intro, elements: subjectElements(plan.forms.subject) });
  const { subjectId, subject } = subjectAnswers(subjectForm.values);
  if (!gate.checkAge(subject.age).eligible) {
    showMessage(display, plan.consent.decline_message ?? 'Sorry, you are not eligible to take part in this study. Nothing has been stored. You can close this window.');
    return { status: 'ineligible' };
  }
  const sessionForm = await showForm(screen, { title: plan.forms.session?.title ?? 'Session', intro: plan.forms.session?.intro, elements: sessionElements(plan.forms.session) });
  const { sessionId, sessionFields } = sessionAnswers(sessionForm.values);

  // 3. device check (a pure decision here; its events are recorded below)
  const env = readEnvironment(globalThis);
  const debug = plan.debug?.enabled ? plan.debug : {};
  const resolved = await chooseProfile(screen, plan, env, debug.simulate_profile);
  const profile = resolved.profile ?? 'unknown';

  // 4. connect trigger sinks (only for a device that will be admitted; nothing is recorded yet)
  const permitted = plan.device?.allowed ?? Object.keys(profileConditions(plan.device ?? {}));
  const { sinkSet } = services;
  let sinkWarnings = [];
  if (resolved.profile !== null && permitted.includes(profile) && sinkSet.configs.length) {
    const connected = await connectSinks(screen, sinkSet);
    if (!connected.ok) {
      await sinkSet.closeAll();
      showMessage(display, `The required trigger device **${connected.blocked.id}** is not connected, so the session cannot start. Nothing has been stored.`);
      return { status: 'sink_failed' };
    }
    sinkWarnings = connected.warnings;
  }

  // 5. start recording: record, store, then session.start as the first event
  const seed = resolveSeed(plan.seed);
  const textHash = await hashText(project.consentText ?? '');
  const startedAt = isoNow();
  const record = createSessionRecord({
    subjectId, sessionId, startedAt,
    experiment: { name: plan.name, spec_version: plan.spec_version, spec_hash: project.specHash, framework_version: FRAMEWORK_VERSION, seed, ...(project.customModules.length ? { custom_modules: project.customModules } : {}) },
    consent: gate.record({ textHash, acceptedAt }),
    device: deviceRecord(env, { profile, reason: resolved.reason }, plan.device?.calibration ? { method: plan.device.calibration.mode ?? 'none', viewing_distance_mm: plan.device.calibration.viewing_distance_mm } : undefined),
    clock: clock.anchor(),
    stage: { rect: services.stage.rect, aspect: services.stage.rect.w / services.stage.rect.h, letterboxed: plan.stage?.aspect !== undefined && plan.stage.aspect !== 'fill' },
    subject,
    session_fields: sessionFields,
    url_params: parseUrlParams(search, plan.capture_url_params),
    sinks: { ...(sinkSet.configs.length ? { trigger: sinkSet.record() } : {}), storage: ['local'] },
  });
  store.begin(record);
  bus.on('*', (event) => store.append(event));
  services.input.onLeave(() => store.flush());
  bus.startRecording();
  // 'closed' is not logged: it would come after the last event the record counts.
  store.onStatus?.((status) => status.state !== 'closed' && bus.emit({ source: 'storage', type: 'storage.status', data: { sink: 'local', ...status } }));
  bus.emit({ source: 'system', type: 'session.start', data: { experiment: plan.name, spec_version: plan.spec_version, spec_hash: project.specHash, framework_version: FRAMEWORK_VERSION, seed, profile } });
  bus.emit({ source: 'system', type: 'session.clock_anchor', data: { time_origin_ms: record.clock.time_origin_ms, wall_iso: record.clock.wall_iso } });
  if (debug.time_scale !== undefined && debug.time_scale !== 1) {
    bus.emit({ source: 'system', type: 'system.warning', data: { code: 'debug_time_scale', message: `durations are scaled by ${debug.time_scale}; this is not valid data` } });
  }

  sinkSet.flushBacklog();
  for (const { id, error } of sinkWarnings) {
    bus.emit({ source: 'system', type: 'system.warning', data: { code: 'sink_unavailable', message: `optional trigger sink "${id}" is not available: ${error}`, detail: { sink: id } } });
  }

  const admission = admitDevice(bus, plan.device ?? {}, { env, chosen: resolved.reason === 'prompt' ? profile : undefined, override: debug.simulate_profile });
  const finish = async (reason) => {
    const done = finishSessionRecord(record, { reason, endedAt: isoNow(), lastSeq: bus.lastSeq });
    await store.finish(done);
    return done;
  };
  if (!admission.admitted) {
    const done = await finish('device_rejected');
    showMessage(display, admission.message);
    return { status: 'device_rejected', record: done };
  }

  bus.emit({ source: 'system', type: 'consent.accepted', data: { text_hash: textHash, mode: plan.consent.mode ?? 'on_screen', statements: record.consent.statements } });
  bus.emit({ source: 'system', type: 'form.submitted', data: { form_id: 'subject', duration_ms: subjectForm.durationMs } });
  bus.emit({ source: 'system', type: 'form.submitted', data: { form_id: 'session', duration_ms: sessionForm.durationMs } });
  services.stage.layout(true);

  // 6. blocks
  const answers = { subject: { subject_id: subjectId, ...subject }, session: { session_id: sessionId, ...sessionFields }, device: { profile } };
  services.setSessionContext(answers);
  try {
    await runBlocks({ services, plan, profile, seed, answers });
  } catch (error) {
    bus.emit({ source: 'system', type: 'system.error', data: { code: 'exception', message: String(error.message ?? error), fatal: true } });
    bus.emit({ source: 'system', type: 'session.end', data: { reason: 'error' } });
    const done = await finish('error');
    await sinkSet.closeAll();
    showMessage(display, 'Something went wrong and the session had to stop. Please tell the experimenter.');
    return { status: 'error', record: done, error };
  }

  // 7. finish: let queued triggers go out (and be logged) before the session ends
  await sinkSet.drain();
  const unsupported = exportFormats.filter((format) => !SUPPORTED_FORMATS.includes(format));
  if (unsupported.length) {
    bus.emit({ source: 'system', type: 'system.warning', data: { code: 'export_format_unsupported', message: `export_on_finish ${unsupported.join(', ')} is not available yet and was skipped` } });
  }
  bus.emit({ source: 'system', type: 'session.end', data: { reason: 'complete' } });
  const done = await finish('complete');
  await sinkSet.closeAll();
  await exportSession(display.ownerDocument, store, exportFormats);
  finishScreen(display, plan, done);
  return { status: 'complete', record: done };
}
