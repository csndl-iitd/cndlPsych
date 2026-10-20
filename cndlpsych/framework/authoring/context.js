// Shared compile context: the parsed documents plus lookups every check needs.
import { BUILTIN_MODULES, BUILTIN_PROFILES } from './defaults.js';
import { expandStimuli } from './stimuli.js';

export const FILES = {
  experiment: 'experiment.yaml',
  forms: 'forms.yaml',
  stimuli: 'stimuli.yaml',
  timeline: 'timeline.yaml',
};

/**
 * Event name -> { fields, open } from the generated event.schema.json, plus the wildcard
 * families (task.*, semantic.*). `fields` lists data keys a `where` may refer to.
 */
export function eventTable(eventSchema) {
  const exact = new Map();
  const families = new Map();
  for (const { if: condition, then } of eventSchema.allOf) {
    const type = condition.properties.type;
    const data = then.properties.data;
    const entry = { fields: new Set(Object.keys(data.properties)), open: data.additionalProperties === true };
    if (type.const) exact.set(type.const, entry);
    else families.set(type.pattern.match(/^\^([a-z0-9_]+)/)[1], entry);
  }
  return { exact, families };
}

export function createContext({ docs, schemas, custom = {}, assets = null, report }) {
  const { experiment, forms, stimuli: stimuliDoc, timeline } = docs;
  const expanded = expandStimuli(stimuliDoc);
  const store = new Map();
  for (const entry of expanded) if (!store.has(entry.name)) store.set(entry.name, entry);

  const customProfiles = Object.keys(experiment.device?.profiles ?? {});
  const known = new Set([...BUILTIN_PROFILES, ...customProfiles]);
  const allowed = experiment.device?.allowed ?? [...known];

  return {
    report,
    experiment,
    forms,
    stimuliDoc,
    timeline,
    expanded,
    store,
    profiles: { known, allowed },
    sinks: experiment.triggers?.sinks ?? [],
    tasks: custom.tasks ?? {},
    generators: custom.stimuli ?? {},
    assets: assets ? new Set(assets) : null,
    events: eventTable(schemas['event.schema.json']),
    schemas,
  };
}

export const isBuiltinModule = (module) => BUILTIN_MODULES.includes(module);

export const taskManifest = (ctx, block) => ctx.tasks[block.module];

/** Profiles a block runs on: `profiles` / `skip_on` applied to the experiment's allowed set. */
export function blockProfiles(ctx, block) {
  let profiles = ctx.profiles.allowed.filter((profile) => ctx.profiles.known.has(profile));
  if (block.profiles) profiles = profiles.filter((profile) => block.profiles.includes(profile));
  if (block.skip_on) profiles = profiles.filter((profile) => !block.skip_on.includes(profile));
  return profiles;
}

/** Every cascade scope as written: experiment, each block, each response_task trial. */
export function* writtenScopes(ctx) {
  yield { file: FILES.experiment, path: [], input: ctx.experiment.input, triggers: ctx.experiment.triggers };
  for (const [i, block] of ctx.timeline.blocks.entries()) {
    const path = ['blocks', i];
    yield { file: FILES.timeline, path, input: block.input, triggers: block.triggers };
    if (block.module !== 'response_task') continue;
    for (const [t, trial] of block.config.trials.entries()) {
      yield { file: FILES.timeline, path: [...path, 'config', 'trials', t], input: trial.input, triggers: trial.triggers };
    }
  }
}
