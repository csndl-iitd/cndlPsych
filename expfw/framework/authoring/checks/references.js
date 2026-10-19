// Cross references between files: modules, stimuli, forms, sinks, profiles, assets, fields.
import { BUILTIN_FIELDS, BUILTIN_MODULES } from '../defaults.js';
import { FILES, isBuiltinModule, taskManifest, writtenScopes } from '../context.js';
import { blockReferences } from '../stimuli.js';

const BUILTIN_STIMULUS_TYPES = ['html', 'text', 'image', 'audio', 'shape', 'fill', 'blank'];
const INTENT_META_KEYS = ['hint', 'plugin_key', 'doc'];
const PREDICATE_COMBINATORS = ['all', 'any', 'not'];
const isUrl = (src) => /^(https?:|data:|blob:)/.test(src);

function checkModules(ctx) {
  ctx.timeline.blocks.forEach((block, b) => {
    if (isBuiltinModule(block.module) || taskManifest(ctx, block)) return;
    const hint = block.module === 'keyboard_task'
      ? ' (keyboard_task was removed; use response_task)'
      : `; built-in modules are ${BUILTIN_MODULES.join(', ')}, custom tasks live in custom/tasks/<module>.js`;
    ctx.report.error('unknown-module', FILES.timeline, ['blocks', b, 'module'], `unknown module "${block.module}"${hint}`);
  });
}

function checkStimulusTypes(ctx) {
  ctx.stimuliDoc.stimuli?.forEach((entry, i) => {
    if (BUILTIN_STIMULUS_TYPES.includes(entry.type) || ctx.generators[entry.type]) return;
    ctx.report.error('unknown-stimulus-type', FILES.stimuli, ['stimuli', i, 'type'], `"${entry.type}" is not a built-in stimulus type and custom/stimuli/${entry.type}.js does not exist`);
  });
}

const literalNames = (condition) => (typeof condition === 'string' && !condition.includes('*') ? [condition]
  : Array.isArray(condition) ? condition.filter((name) => typeof name === 'string' && !name.includes('*')) : []);

function checkStimulusNames(ctx, names, file, path) {
  for (const name of names) {
    if (!ctx.store.has(name)) ctx.report.error('unknown-stimulus', file, path, `unknown stimulus "${name}"`);
  }
}

function checkStimulusReferences(ctx) {
  ctx.timeline.blocks.forEach((block, b) => {
    const path = ['blocks', b];
    const { refs, unknownFactors } = blockReferences(block, path, taskManifest(ctx, block));
    for (const { name, path: refPath } of refs) checkStimulusNames(ctx, [name], FILES.timeline, refPath);
    for (const { factor, path: refPath } of unknownFactors) {
      ctx.report.error('unknown-factor', FILES.timeline, refPath, `"{${factor}}" is not a factor of this block's design`);
    }
    if (block.module !== 'response_task') return;
    block.config.trials.forEach((trial, t) => {
      const where = trial.correct?.where?.stimulus;
      checkStimulusNames(ctx, literalNames(where), FILES.timeline, [...path, 'config', 'trials', t, 'correct', 'where', 'stimulus']);
    });
  });
  for (const { file, path, triggers } of writtenScopes(ctx)) {
    (triggers?.rules ?? []).forEach((rule, i) => {
      if (!['phase.onset', 'phase.offset'].includes(rule.on)) return;
      const rulePath = [...path, 'triggers', 'rules', i, 'where', 'stimulus'];
      checkStimulusNames(ctx, literalNames(rule.where?.stimulus), file, rulePath);
    });
  }
}

function checkDesigns(ctx) {
  ctx.timeline.blocks.forEach((block, b) => {
    const design = block.config?.design;
    if (block.module !== 'response_task' || !design) return;
    const factors = new Set(Object.keys(design.factors));
    const base = ['blocks', b, 'config'];
    design.constraints?.forEach(({ max_run: run }, c) => {
      if (!factors.has(run.factor)) ctx.report.error('unknown-factor', FILES.timeline, [...base, 'design', 'constraints', c, 'max_run', 'factor'], `"${run.factor}" is not a design factor`);
    });
    block.config.trials.forEach((trial, t) => {
      for (const key of Object.keys(trial.applies_to ?? {})) {
        if (!PREDICATE_COMBINATORS.includes(key) && !factors.has(key)) {
          ctx.report.error('unknown-factor', FILES.timeline, [...base, 'trials', t, 'applies_to', key], `"${key}" is not a design factor`);
        }
      }
    });
  });
}

function checkForms(ctx) {
  const formIds = new Set((ctx.forms.forms ?? []).map(({ id }) => id));
  ctx.timeline.blocks.forEach((block, b) => {
    if (block.module !== 'survey' || formIds.has(block.config.form_id)) return;
    ctx.report.error('unknown-form', FILES.timeline, ['blocks', b, 'config', 'form_id'], `form "${block.config.form_id}" is not defined in forms.yaml`);
  });
  (ctx.forms.forms ?? []).forEach((form, f) => {
    const earlier = new Set();
    form.questions.forEach((question, q) => {
      for (const key of Object.keys(question.show_if ?? {})) {
        const field = key.split('.')[0];
        if (!PREDICATE_COMBINATORS.includes(key) && !earlier.has(field)) {
          ctx.report.error('unknown-question', FILES.forms, ['forms', f, 'questions', q, 'show_if', key], `"${field}" is not an earlier question of form "${form.id}"`);
        }
      }
      earlier.add(question.name);
    });
  });
}

function answerFields(ctx) {
  const names = (builtin) => [...BUILTIN_FIELDS[builtin], ...(ctx.forms[builtin]?.questions ?? []).map(({ name }) => name)];
  return { subject: new Set(names('subject')), session: new Set(names('session')) };
}

function checkPredicateFields(ctx, predicate, path, fields) {
  for (const [key, value] of Object.entries(predicate ?? {})) {
    if (key === 'not') checkPredicateFields(ctx, value, [...path, key], fields);
    else if (PREDICATE_COMBINATORS.includes(key)) value.forEach((inner, i) => checkPredicateFields(ctx, inner, [...path, key, i], fields));
    else {
      const [root, name] = key.split('.');
      const valid = root === 'device' ? name === 'profile' : fields[root]?.has(name);
      if (!valid) ctx.report.error('unknown-question', FILES.timeline, [...path, key], `"${key}" is not a subject.*, session.* or device.profile field`);
    }
  }
}

function checkWhen(ctx) {
  const fields = answerFields(ctx);
  ctx.timeline.blocks.forEach((block, b) => checkPredicateFields(ctx, block.when, ['blocks', b, 'when'], fields));
}

function checkSinks(ctx) {
  const sinkIds = new Set(ctx.sinks.map(({ id }) => id));
  for (const { file, path, triggers } of writtenScopes(ctx)) {
    (triggers?.rules ?? []).forEach((rule, i) => {
      rule.sinks?.forEach((id, s) => {
        if (!sinkIds.has(id)) ctx.report.error('unknown-sink', file, [...path, 'triggers', 'rules', i, 'sinks', s], `sink "${id}" is not defined in experiment.yaml`);
      });
    });
  }
}

function checkProfileList(ctx, profiles, file, path) {
  profiles?.forEach((profile, i) => {
    if (!ctx.profiles.known.has(profile)) ctx.report.error('unknown-profile', file, [...path, i], `unknown device profile "${profile}"`);
  });
}

function checkProfiles(ctx) {
  const { experiment, report } = ctx;
  const { allowed, known } = ctx.profiles;
  checkProfileList(ctx, experiment.device?.allowed, FILES.experiment, ['device', 'allowed']);
  checkProfileList(ctx, experiment.device?.calibration?.profiles, FILES.experiment, ['device', 'calibration', 'profiles']);
  if (experiment.device?.fixed) {
    checkProfileList(ctx, [experiment.device.fixed], FILES.experiment, ['device', 'fixed']);
    if (!allowed.includes(experiment.device.fixed)) report.error('device-fixed-not-allowed', FILES.experiment, ['device', 'fixed'], `fixed profile "${experiment.device.fixed}" is not in device.allowed`);
  }
  if (experiment.eyetracking?.enabled) {
    (experiment.eyetracking.profiles ?? ['desktop']).forEach((profile, i) => {
      if (!allowed.includes(profile)) report.error('eyetracking-profile-not-allowed', FILES.experiment, ['eyetracking', 'profiles', i], `eye tracking profile "${profile}" is not in device.allowed`);
    });
  }
  ctx.timeline.blocks.forEach((block, b) => {
    for (const key of ['profiles', 'skip_on']) checkProfileList(ctx, block[key], FILES.timeline, ['blocks', b, key]);
    block.profiles?.forEach((profile, i) => {
      if (known.has(profile) && !allowed.includes(profile)) report.error('block-profile-not-allowed', FILES.timeline, ['blocks', b, 'profiles', i], `profile "${profile}" is not in device.allowed`);
    });
  });
  for (const { file, path, input } of writtenScopes(ctx)) checkInputProfiles(ctx, input, file, path.length ? [...path, 'input'] : ['input']);
}

function checkInputProfiles(ctx, scope, file, path) {
  const { known } = ctx.profiles;
  const unknown = (key) => key !== '*' && !known.has(key);
  for (const key of Object.keys(scope?.profiles ?? {})) {
    if (unknown(key)) ctx.report.error('unknown-profile', file, [...path, 'profiles', key], `unknown device profile "${key}"`);
  }
  for (const [name, definition] of Object.entries(scope?.intents ?? {})) {
    for (const key of Object.keys(definition).filter((k) => !INTENT_META_KEYS.includes(k))) {
      if (unknown(key)) ctx.report.error('unknown-profile', file, [...path, 'intents', name, key], `unknown device profile "${key}"`);
    }
    for (const key of Object.keys(typeof definition.hint === 'object' ? definition.hint : {})) {
      if (unknown(key)) ctx.report.error('unknown-profile', file, [...path, 'intents', name, 'hint', key], `unknown device profile "${key}"`);
    }
  }
}

function checkFiles(ctx) {
  const { report, assets, experiment } = ctx;
  if (!assets) return;
  if (experiment.consent.file && !assets.has(experiment.consent.file)) {
    report.error('consent-file-missing', FILES.experiment, ['consent', 'file'], `consent file "${experiment.consent.file}" was not found in the project`);
  }
  ctx.stimuliDoc.stimuli?.forEach((entry, i) => {
    if (entry.src && !isUrl(entry.src) && !assets.has(entry.src)) {
      report.error('missing-asset', FILES.stimuli, ['stimuli', i, 'src'], `asset "${entry.src}" was not found in the project`);
    }
  });
}

function checkConsent(ctx) {
  const age = ctx.forms.subject?.overrides?.age;
  if (ctx.experiment.consent.min_age !== undefined && age?.required === false) {
    ctx.report.error('min-age-needs-age', FILES.forms, ['subject', 'overrides', 'age', 'required'], 'consent.min_age needs the age answer, so the age field cannot be made optional');
  }
}

export function checkReferences(ctx) {
  checkModules(ctx);
  checkStimulusTypes(ctx);
  checkStimulusReferences(ctx);
  checkDesigns(ctx);
  checkForms(ctx);
  checkWhen(ctx);
  checkSinks(ctx);
  checkProfiles(ctx);
  checkFiles(ctx);
  checkConsent(ctx);
}
