// Unique ids: blocks, trials, rules, sinks, forms, questions, expanded stimuli.
import { FILES, writtenScopes } from '../context.js';
import { hasEachPlaceholder } from '../stimuli.js';

function reportDuplicates(report, code, file, items, noun) {
  const first = new Map();
  for (const { id, path } of items) {
    if (first.has(id)) report.error(code, file, path, `duplicate ${noun} "${id}" (first defined at ${first.get(id)})`);
    else first.set(id, path.join('.'));
  }
}

function checkStimuli(ctx) {
  const { report } = ctx;
  ctx.stimuliDoc.stimuli?.forEach((entry, i) => {
    const templated = hasEachPlaceholder(entry.name);
    if (entry.each && !templated) {
      report.error('each-name-template', FILES.stimuli, ['stimuli', i, 'name'], `"${entry.name}" uses 'each' but has no {value} or {index} placeholder, so every copy gets the same name`);
    }
    if (!entry.each && templated) {
      report.error('each-name-template', FILES.stimuli, ['stimuli', i, 'name'], `"${entry.name}" has a {value}/{index} placeholder but no 'each' list`);
    }
  });
  reportDuplicates(report, 'duplicate-stimulus', FILES.stimuli, ctx.expanded.map(({ name, path }) => ({ id: name, path })), 'stimulus');
}

function checkRuleIds(ctx) {
  for (const { file, path, input, triggers } of writtenScopes(ctx)) {
    const triggerPath = path.length ? [...path, 'triggers'] : ['triggers'];
    const inputPath = path.length ? [...path, 'input'] : ['input'];
    const triggerRules = (triggers?.rules ?? []).map(({ id }, i) => ({ id, path: [...triggerPath, 'rules', i] }));
    reportDuplicates(ctx.report, 'duplicate-rule-id', file, triggerRules, 'trigger rule');
    for (const [profile, scope] of Object.entries(input?.profiles ?? {})) {
      const rules = (scope.rules ?? []).map(({ id }, i) => ({ id, path: [...inputPath, 'profiles', profile, 'rules', i] }));
      reportDuplicates(ctx.report, 'duplicate-rule-id', file, rules, 'input rule');
    }
  }
}

// A scope that disables an id and also defines it has no sensible meaning: say so.
function checkDisableConflicts(ctx) {
  const conflicts = (file, path, disabled, defined) => {
    disabled?.forEach((id, i) => {
      if (defined.includes(id)) ctx.report.error('disable-conflict', file, [...path, 'disable', i], `"${id}" is both disabled and defined in the same scope`);
    });
  };
  for (const { file, path, input, triggers } of writtenScopes(ctx)) {
    const inputPath = path.length ? [...path, 'input'] : ['input'];
    conflicts(file, inputPath, input?.disable, Object.keys(input?.intents ?? {}));
    const profiles = Object.entries(input?.profiles ?? {});
    const idsOf = ([, scope]) => (scope.rules ?? []).map(({ id }) => id);
    for (const entry of profiles) {
      // "*" is applied before the concrete profile, so a "*" disable also clashes with their rules.
      const defined = entry[0] === '*' ? profiles.flatMap(idsOf) : idsOf(entry);
      conflicts(file, [...inputPath, 'profiles', entry[0]], entry[1].disable, defined);
    }
    conflicts(file, path.length ? [...path, 'triggers'] : ['triggers'], triggers?.disable, (triggers?.rules ?? []).map(({ id }) => id));
  }
}

function checkForms(ctx) {
  const { report, forms } = ctx;
  const fileForms = forms.forms ?? [];
  reportDuplicates(report, 'duplicate-form-id', FILES.forms, fileForms.map(({ id }, i) => ({ id, path: ['forms', i] })), 'form id');
  fileForms.forEach((form, f) => {
    const questions = form.questions.map(({ name }, q) => ({ id: name, path: ['forms', f, 'questions', q] }));
    reportDuplicates(report, 'duplicate-question', FILES.forms, questions, 'question');
  });
  for (const builtin of ['subject', 'session']) {
    const questions = (forms[builtin]?.questions ?? []).map(({ name }, q) => ({ id: name, path: [builtin, 'questions', q] }));
    reportDuplicates(report, 'duplicate-question', FILES.forms, questions, 'question');
  }
}

export function checkNames(ctx) {
  const { report } = ctx;
  const blocks = ctx.timeline.blocks;
  reportDuplicates(report, 'duplicate-block-id', FILES.timeline, blocks.map(({ id }, i) => ({ id, path: ['blocks', i] })), 'block id');
  blocks.forEach((block, b) => {
    if (block.module !== 'response_task') return;
    const trials = block.config.trials.map(({ name }, t) => ({ id: name, path: ['blocks', b, 'config', 'trials', t] }));
    reportDuplicates(report, 'duplicate-trial-name', FILES.timeline, trials, 'trial name');
  });
  reportDuplicates(report, 'duplicate-sink-id', FILES.experiment, ctx.sinks.map(({ id }, i) => ({ id, path: ['triggers', 'sinks', i] })), 'sink id');
  checkStimuli(ctx);
  checkRuleIds(ctx);
  checkDisableConflicts(ctx);
  checkForms(ctx);
}
