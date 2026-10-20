// Building the session record when recording starts. Only the facts known at that moment; what
// is learned later (end time, eye tracking summary) is added by the finisher in finish.js.
import { deviceRecord } from '../../foundation/device.js';
import { createSessionRecord, parseUrlParams } from '../../foundation/session.js';
import { isoNow } from '../../foundation/clock.js';
import { FRAMEWORK_VERSION } from './version.js';

/** The `sinks` part of the record: the trigger sinks, and where the data is stored. */
export const sinkRecord = (sinkSet, remote) => ({
  ...(sinkSet.configs.length ? { trigger: sinkSet.record() } : {}),
  storage: remote ? ['local', 'firebase'] : ['local'],
});

const calibrationRecord = (plan) => (plan.device?.calibration
  ? { method: plan.device.calibration.mode ?? 'none', viewing_distance_mm: plan.device.calibration.viewing_distance_mm }
  : undefined);

/**
 * @param {{
 *   run: {services: object, project: object, remote: object|null, env: object},
 *   ids: {subjectId: string, sessionId: string}, answers: {subject: object, sessionFields: object},
 *   gate: object, consent: {textHash: string, acceptedAt: string},
 *   device: {profile: string, reason: string}, seed: number, refreshHz?: number, search: string,
 * }} options
 */
export function buildSessionRecord({ run, ids, answers, gate, consent, device, seed, refreshHz, search }) {
  const { services, project, remote, env } = run;
  const { plan } = project;
  const { rect } = services.stage;
  const record = createSessionRecord({
    subjectId: ids.subjectId,
    sessionId: ids.sessionId,
    startedAt: isoNow(),
    experiment: {
      name: plan.name,
      spec_version: plan.spec_version,
      spec_hash: project.specHash,
      framework_version: FRAMEWORK_VERSION,
      seed,
      ...(project.customModules.length ? { custom_modules: project.customModules } : {}),
    },
    consent: gate.record({ textHash: consent.textHash, acceptedAt: consent.acceptedAt }),
    device: deviceRecord(env, device, calibrationRecord(plan), refreshHz),
    clock: services.clock.anchor(),
    stage: { rect, aspect: rect.w / rect.h, letterboxed: plan.stage?.aspect !== undefined && plan.stage.aspect !== 'fill' },
    subject: answers.subject,
    session_fields: answers.sessionFields,
    url_params: parseUrlParams(search, plan.capture_url_params),
    sinks: sinkRecord(services.sinkSet, remote),
    overlays: services.overlay.record(),
  });
  return run.mode?.test ? { ...record, mode: 'test' } : record;
}
