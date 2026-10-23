// Live and test mode: the blocks named in `modes.<mode>.block_trials` must exist and be blocks of trials.
import { FILES } from '../context.js';

export function checkModes(ctx) {
  const { modes } = ctx.experiment;
  if (!modes) return;
  const blocks = new Map(ctx.timeline.blocks.map((block) => [block.id, block]));
  for (const mode of ['live', 'test']) {
    for (const id of Object.keys(modes[mode]?.block_trials ?? {})) {
      const path = ['modes', mode, 'block_trials', id];
      if (!blocks.has(id)) ctx.report.error('mode-block-unknown', FILES.experiment, path, `"${id}" is not a block of timeline.yaml`);
      else if (blocks.get(id).module !== 'response_task') ctx.report.warn('mode-block-no-trials', FILES.experiment, path, `block "${id}" is not a block of trials (module ${blocks.get(id).module}), so the number has no effect`);
    }
  }
}
