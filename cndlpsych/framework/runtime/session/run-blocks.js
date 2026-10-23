// Running the blocks of the timeline in order.
import { buildInstructions } from '../../authoring/modules/instructions.js';
import { runNodes } from '../../authoring/modules/jspsych.js';
import { buildResponseTask } from '../../authoring/modules/response-task.js';
import { blockApplies } from '../../authoring/modules/plan.js';
import { buildSurvey } from '../../authoring/modules/survey.js';
import { createRng } from '../../foundation/rng.js';

const BUILDERS = { response_task: buildResponseTask, instructions: buildInstructions, survey: buildSurvey };
const TEXT_MODULES = ['instructions', 'survey']; // blocks of text and forms, which do not use stage positions

/**
 * Run the blocks in order. When resuming, `resume` says where to carry on: earlier blocks are
 * skipped, the interrupted run skips its finished trials, and its block.start (already in the
 * log) is not written again. `beforeBlock` may stop the session by resolving to false. `trialLimit(blockId)` is
 * the most trials a block of trials runs (test mode), or null.
 */
export async function runBlocks({ services, plan, profile, seed, answers, resume, beforeBlock, trialLimit = () => null }) {
  const { bus, jsPsych } = services;
  const master = createRng(seed);
  let lostSink = null;
  services.onRequiredSinkLost((id) => {
    lostSink = lostSink ?? id;
    jsPsych.abortExperiment('A required trigger device was lost. The session has stopped.');
  });
  for (const [index, planBlock] of plan.blocks.entries()) {
    if (resume && index < resume.blockIndex) continue;
    if (!blockApplies(planBlock, profile, answers)) {
      bus.emit({ source: 'system', type: 'block.end', block: planBlock.id, data: { block_id: planBlock.id, reason: 'skipped' } });
      continue;
    }
    const build = BUILDERS[planBlock.module];
    if (!build) throw new Error(`module "${planBlock.module}" is not available (custom tasks are not supported yet)`);
    services.setDisplayMode('text'); // what the steps between blocks show (eye tracking set-up) is text
    if (!(await beforeBlock())) throw Object.assign(new Error('eye tracking could not be validated'), { endReason: 'aborted' });
    services.setDisplayMode(TEXT_MODULES.includes(planBlock.module) ? 'text' : 'stage');
    const resumedBlock = resume && index === resume.blockIndex;
    for (let run = resumedBlock ? resume.run : 1; run <= planBlock.repeat; run += 1) {
      const resumedRun = resumedBlock && run === resume.run;
      const ctx = services.moduleContext({ rng: master.fork(`block:${planBlock.id}:${run}`), profile });
      const { nodes, nTrials } = build(ctx, planBlock, { skipTrials: resumedRun ? resume.completedTrials : 0, limit: trialLimit(planBlock.id) });
      ctx.applyTriggers(planBlock.triggers);
      bus.setContext({ block: planBlock.id, trial: null, phase: null });
      if (!(resumedRun && resume.started)) {
        bus.emit({ source: 'system', type: 'block.start', data: { block_id: planBlock.id, module: planBlock.module, n_trials: nTrials } });
      }
      if (nodes.length) await runNodes(jsPsych, nodes);
      if (lostSink) throw new Error(`the required trigger sink "${lostSink}" was lost during the session`);
      bus.emit({ source: 'system', type: 'block.end', data: { block_id: planBlock.id, reason: 'complete' } });
      ctx.applyTriggers({ enabled: false, rules: [] });
      bus.setContext({ block: null, trial: null, phase: null });
    }
  }
  services.setDisplayMode('text'); // the end of the session is a message
}
