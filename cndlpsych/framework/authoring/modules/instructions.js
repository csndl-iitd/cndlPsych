// The instructions module: pages are stimulus names (stimuli.yaml) or inline html / text.
// Advancing uses an intent (default `any`: any key or a tap anywhere), so the same screen
// works on every device; an optional `back` intent steps back a page.
import { phaseTrial } from './phase.js';
import { drawDuration } from './plan.js';

const DEFAULT_ADVANCE = 'any';

function pageDefinition(page, index, plan) {
  if (typeof page === 'string') {
    const definition = plan.stimuli[page];
    if (!definition) throw new Error(`instructions page ${index + 1} refers to unknown stimulus "${page}"`);
    return { stimulus: page };
  }
  if (page.html !== undefined) return { definition: { name: `page_${index + 1}`, type: 'html', html: page.html } };
  return { definition: { name: `page_${index + 1}`, type: 'text', text: page.text } };
}

/**
 * @param {import('./phase.js').ModuleContext} ctx
 * @param {object} planBlock compiled block (config: {pages, advance?, back?, min_time?, post?})
 * @returns {{nodes: object[], nTrials: number}}
 */
export function buildInstructions(ctx, planBlock) {
  const { pages, advance = DEFAULT_ADVANCE, back = null, min_time: minTime, post } = planBlock.config;
  const rng = ctx.rng.fork(`instructions:${planBlock.id}`);
  const accepted = back ? [advance, back] : [advance];
  const state = { index: 0, last: null, unsubscribe: null };

  const render = (index) => () => {
    const page = pageDefinition(pages[index], index, ctx.plan);
    return (page.stimulus
      ? ctx.renderStimulus(page.stimulus, { trial: 0, rng, vars: {} })
      : ctx.renderDefinition(page.definition, { trial: 0, rng, vars: {} })).html;
  };

  const waitMs = minTime === undefined ? 0 : ctx.scale(drawDuration(minTime, rng, ctx.frameMs));
  const pageNode = {
    timeline: [
      // A short no-response phase first when min_time is set (the page shows through both phases).
      phaseTrial(ctx, {
        name: 'page_wait',
        html: () => render(state.index)(),
        durationMs: waitMs || null,
        skip: () => waitMs === 0,
        accepted: [],
      }),
      phaseTrial(ctx, {
        name: 'page',
        stimulus: () => (typeof pages[state.index] === 'string' ? pages[state.index] : undefined),
        html: () => render(state.index)(),
        durationMs: null,
        accepted,
        endOnResponse: true,
        onStart() { state.last = null; },
        onEnd() {
          const wentBack = state.last === back && back !== null && state.index > 0;
          state.index += wentBack ? -1 : 1;
        },
        reason: () => 'response',
      }),
    ],
    loop_function: () => state.index < pages.length,
  };

  const nodes = [{
    timeline: [pageNode, ...(post === undefined ? [] : [phaseTrial(ctx, { name: 'post', html: () => '', durationMs: ctx.scale(drawDuration(post, rng, ctx.frameMs)) })])],
    on_timeline_start() {
      state.index = 0;
      ctx.applyScope(ctx.inputScope(planBlock.input));
      state.unsubscribe = ctx.bus.on('semantic.*', (event) => {
        if (accepted.includes(event.data.intent)) state.last = state.last === back && back !== null ? back : event.data.intent;
      });
    },
    on_timeline_finish() { state.unsubscribe?.(); },
  }];
  return { nodes, nTrials: 0 };
}
