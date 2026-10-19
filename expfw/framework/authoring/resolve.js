// Resolve the input and trigger cascades for every block (and every response_task
// trial) and assemble the compiled plan's blocks. Runs after the reference checks, so
// stimulus names that do not exist are simply skipped here.
import { blockReferences } from './stimuli.js';
import { blockProfiles, FILES, taskManifest } from './context.js';
import { INPUT_DEFAULTS } from './defaults.js';
import { resolveInput } from './cascade-input.js';
import { resolveTriggers } from './cascade-triggers.js';

const TIMELINE = FILES.timeline;

function stimulusTriggerScope(ctx, block, blockPath) {
  const { refs } = blockReferences(block, blockPath, taskManifest(ctx, block));
  const rules = [];
  for (const name of new Set(refs.map((ref) => ref.name))) {
    const entry = ctx.store.get(name);
    if (entry?.stimulus.trigger === undefined) continue;
    rules.push({ id: `stim:${name}`, on: 'phase.onset', where: { stimulus: name }, value: entry.stimulus.trigger });
  }
  return { rules };
}

function reportUnknownDisables(report, unknown) {
  for (const { id, kind, file, path } of unknown) {
    report.error('disable-unknown', file, path, `"${id}" does not name an inherited ${kind}`);
  }
}

/** A `disable` is unknown only if it matched nothing for every profile it applied to. */
function unknownDisables(perProfile) {
  const groups = new Map();
  for (const entry of perProfile.flat()) {
    const key = `${entry.file}|${entry.path.join('/')}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].filter((group) => group.every((entry) => entry.unknown)).map((group) => group[0]);
}

function resolveScope(ctx, { inputLevels, triggerLevels, profiles }) {
  const input = {};
  const perProfile = [];
  for (const profile of profiles) {
    const { resolved, disables } = resolveInput(inputLevels, profile);
    input[profile] = resolved;
    perProfile.push(disables);
  }
  reportUnknownDisables(ctx.report, unknownDisables(perProfile));
  const { resolved: triggers, unknownDisables: unknownTriggerDisables } = resolveTriggers(triggerLevels);
  reportUnknownDisables(ctx.report, unknownTriggerDisables);
  return { input, triggers };
}

function checkComplete(ctx, scope, file, path) {
  const { report } = ctx;
  for (const rules of Object.values(scope.input).map((resolved) => resolved.rules)) {
    for (const rule of rules) {
      if (!rule.match || !rule.emit) report.error('rule-incomplete', file, path, `input rule "${rule.id}" has no ${rule.match ? 'emit' : 'match'} after resolving the cascade`);
    }
  }
  for (const rule of scope.triggers.rules) {
    if (!rule.on || rule.value === undefined) report.error('rule-incomplete', file, path, `trigger rule "${rule.id}" has no ${rule.on ? 'value' : 'on'} after resolving the cascade`);
  }
}

function resolveBlock(ctx, block, index, scopes) {
  const path = ['blocks', index];
  const profiles = blockProfiles(ctx, block);
  const manifest = taskManifest(ctx, block);
  const baseInput = [
    { scope: INPUT_DEFAULTS, file: 'framework defaults', path: [] },
    { scope: manifest?.input, file: `custom/tasks/${block.module}.js`, path: ['input'] },
    { scope: ctx.experiment.input, file: FILES.experiment, path: ['input'] },
  ];
  const baseTriggers = [
    { scope: stimulusTriggerScope(ctx, block, path), file: FILES.stimuli, path: [] },
    { scope: ctx.experiment.triggers, file: FILES.experiment, path: ['triggers'] },
  ];
  const blockInput = { scope: block.input, file: TIMELINE, path: [...path, 'input'] };
  const blockTriggers = { scope: block.triggers, file: TIMELINE, path: [...path, 'triggers'] };

  const resolved = resolveScope(ctx, {
    inputLevels: [...baseInput, blockInput],
    triggerLevels: [...baseTriggers, blockTriggers],
    profiles,
  });
  scopes.push({ file: TIMELINE, path, ...resolved });

  const planned = {
    id: block.id,
    index,
    module: block.module,
    ...(block.title === undefined ? {} : { title: block.title }),
    profiles,
    ...(block.when === undefined ? {} : { when: block.when }),
    repeat: block.repeat ?? 1,
    ...(block.data === undefined ? {} : { data: block.data }),
    config: block.config,
    input: resolved.input,
    triggers: resolved.triggers,
  };

  if (block.module === 'response_task') {
    planned.trials = block.config.trials.map((trial, t) => {
      const trialPath = [...path, 'config', 'trials', t];
      const trialScope = resolveScope(ctx, {
        inputLevels: [...baseInput, blockInput, { scope: trial.input, file: TIMELINE, path: [...trialPath, 'input'] }],
        triggerLevels: [...baseTriggers, blockTriggers, { scope: trial.triggers, file: TIMELINE, path: [...trialPath, 'triggers'] }],
        profiles,
      });
      scopes.push({ file: TIMELINE, path: trialPath, trial, ...trialScope });
      const { input, triggers, ...definition } = trial;
      return { ...definition, input: trialScope.input, triggers: trialScope.triggers };
    });
  }
  return planned;
}

/**
 * @returns {{blocks: object[], scopes: object[]}} plan blocks, and every resolved scope
 *   ({file, path, input per profile, triggers, trial?}) for the checks that run on resolved data
 */
export function resolveBlocks(ctx) {
  const scopes = [];
  const blocks = ctx.timeline.blocks.map((block, index) => resolveBlock(ctx, block, index, scopes));
  for (const scope of scopes) checkComplete(ctx, scope, scope.file, scope.path);
  return { blocks, scopes };
}
