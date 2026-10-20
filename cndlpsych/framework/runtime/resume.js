// Resuming an interrupted session. Pure decisions only: where the experiment stopped, and
// whether this session may be continued here and now.
//
// A session is continued, not replayed: same subject, session, seed and device profile, on
// the same experiment files. The seed makes block and trial order identical, so completed
// blocks and trials are skipped and the interrupted trial runs again from its start.
import { resolveProfile } from '../foundation/device.js';

export const RESUMABLE_STATUSES = ['in_progress', 'aborted', 'error'];

/**
 * Where to carry on, from the events saved so far.
 * @param {{blocks: {id: string, repeat: number}[]}} plan
 * @param {object[]} events
 * @returns {{blockIndex: number, run: number, completedTrials: number, started: boolean}}
 *   `blockIndex` equals plan.blocks.length when every block is done and only the end is left;
 *   `started` is true when that run's block.start is already in the log (it is not logged twice)
 */
export function findResumePoint(plan, events) {
  const starts = new Map();
  const completed = new Map();
  const skipped = new Set();
  for (const event of events) {
    const id = event.data.block_id;
    if (event.type === 'block.start') starts.set(id, [...(starts.get(id) ?? []), event.seq]);
    if (event.type === 'block.end') {
      if (event.data.reason === 'skipped') skipped.add(id);
      else if (event.data.reason === 'complete') completed.set(id, (completed.get(id) ?? 0) + 1);
    }
  }
  for (const [blockIndex, planBlock] of plan.blocks.entries()) {
    if (skipped.has(planBlock.id)) continue;
    const done = completed.get(planBlock.id) ?? 0;
    if (done >= planBlock.repeat) continue;
    const run = done + 1;
    const runStarts = starts.get(planBlock.id) ?? [];
    const started = runStarts.length >= run;
    const from = started ? runStarts[run - 1] : Infinity;
    const until = runStarts[run] ?? Infinity;
    const completedTrials = events.filter((e) => e.type === 'trial.end' && e.block === planBlock.id && e.seq > from && e.seq < until).length;
    return { blockIndex, run, completedTrials, started };
  }
  return { blockIndex: plan.blocks.length, run: 1, completedTrials: 0, started: false };
}

const isContiguous = (events) => events.every((event, i) => event.seq === i);

/**
 * Can this saved session be continued on this device with the loaded experiment?
 * @param {{record: object, events: object[], plan: object, specHash: string, env: object, override?: string}} input
 * @returns {{ok: true, point: object} | {ok: false, reason: string}}
 */
export function checkResumable({ record, events, plan, specHash, env, override }) {
  if (!RESUMABLE_STATUSES.includes(record.status)) return { ok: false, reason: 'This session already ended normally.' };
  if (events.length === 0 || events[0].type !== 'session.start' || !isContiguous(events)) {
    return { ok: false, reason: 'The saved log is incomplete, so it cannot be continued.' };
  }
  if (record.experiment.spec_hash !== specHash) {
    return { ok: false, reason: 'The experiment files have changed since this session started, so it cannot be continued.' };
  }
  const original = record.device.profile;
  const current = resolveProfile(plan.device ?? {}, { env, override });
  if (current.pending || (current.profile !== original && !current.candidates.includes(original))) {
    return { ok: false, reason: `This session was recorded on a ${original} device. Continue it on the same kind of device.` };
  }
  return { ok: true, point: findResumePoint(plan, events) };
}

/** The resume entry of the session record, and the end fields a continued session no longer has. */
export function resumedRecord(record, { lastSeq, anchor, resumedAt, point, plan, frameworkVersion, sinks }) {
  const { end_reason: _reason, n_chunks: _chunks, last_seq: _last, ...rest } = record;
  const planBlock = plan.blocks[point.blockIndex];
  const block = planBlock?.id ?? null;
  const trial = planBlock?.module === 'response_task' ? point.completedTrials + 1 : null;
  return {
    ...rest,
    status: 'in_progress',
    ended_at: null,
    resumes: [...(record.resumes ?? []), {
      at_seq: lastSeq, resumed_at: resumedAt, time_origin_ms: anchor.time_origin_ms, wall_iso: anchor.wall_iso,
      block_id: block, trial, framework_version: frameworkVersion,
    }],
    ...(sinks ? { sinks } : {}),
  };
}
