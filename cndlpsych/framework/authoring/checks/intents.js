// Intents: every intent a trial uses is declared and resolves for every profile the
// block runs on; bindings only use gestures that are enabled.
import { BUILTIN_INTENTS } from '../defaults.js';
import { FILES, taskManifest, writtenScopes } from '../context.js';

const HINT_REFERENCE = /\{\{\s*([a-z][a-z0-9_]*)\.hint\s*\}\}/g;
const BINDING_GESTURES = ['tap', 'swipe', 'longpress'];

const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const isBuiltin = (intent) => BUILTIN_INTENTS.includes(intent);

function correctIntents(correct) {
  if (correct && typeof correct === 'object' && !Array.isArray(correct)) return asList(correct.intent);
  return asList(correct);
}

/** Intents a scope's module uses, each with the path it was written at. */
function usedIntents(ctx, block, scope) {
  const { path, trial } = scope;
  const used = [];
  const add = (intents, at) => intents.filter((intent) => !isBuiltin(intent)).forEach((intent) => used.push({ intent, path: at }));
  if (trial) {
    add(asList(trial.response), [...path, 'response']);
    add(correctIntents(trial.correct), [...path, 'correct']);
  } else if (block.module === 'instructions') {
    add(asList(block.config.advance), [...path, 'config', 'advance']);
    add(asList(block.config.back), [...path, 'config', 'back']);
  } else if (block.module !== 'response_task') {
    add(taskManifest(ctx, block)?.requires?.intents ?? [], [...path, 'config']);
  }
  return used;
}

function emittedIntents(rules) {
  return rules.flatMap((rule) => asList(rule.emit).map((item) => item.intent).filter(Boolean));
}

function checkDeclarations(ctx, scope, profileScope) {
  const declared = new Set([...BUILTIN_INTENTS, ...Object.keys(profileScope.intents)]);
  for (const rule of profileScope.rules) {
    for (const intent of emittedIntents([rule])) {
      if (!declared.has(intent)) ctx.report.error('unknown-intent', scope.file, scope.path, `input rule "${rule.id}" emits undeclared intent "${intent}"`);
    }
  }
  return declared;
}

function checkGestures(ctx, scope, profile, profileScope) {
  for (const [name, { bindings }] of Object.entries(profileScope.intents)) {
    for (const binding of bindings) {
      const gesture = BINDING_GESTURES.find((candidate) => candidate in binding);
      if (gesture && !(profileScope.gestures ?? []).includes(gesture)) {
        ctx.report.error('gesture-not-enabled', scope.file, scope.path, `intent "${name}" has a ${gesture} binding on "${profile}" but the ${gesture} gesture is not enabled`);
      }
    }
  }
}

function checkScope(ctx, scope, block) {
  const profiles = Object.keys(scope.input);
  if (profiles.length === 0) return;
  const declared = profiles.map((profile) => checkDeclarations(ctx, scope, scope.input[profile]));
  profiles.forEach((profile) => checkGestures(ctx, scope, profile, scope.input[profile]));

  for (const { intent, path } of usedIntents(ctx, block, scope)) {
    if (!declared[0].has(intent)) {
      ctx.report.error('unknown-intent', scope.file, path, `intent "${intent}" is not declared in any input scope that applies here`);
      continue;
    }
    for (const profile of profiles) {
      const profileScope = scope.input[profile];
      const covered = profileScope.intents[intent].bindings.length > 0 || emittedIntents(profileScope.rules).includes(intent);
      if (!covered) ctx.report.error('uncovered-intent', scope.file, path, `intent "${intent}" has no binding or rule for profile "${profile}"`);
    }
  }
}

function checkHints(ctx) {
  const declared = new Set(BUILTIN_INTENTS);
  const addIntents = (input) => Object.keys(input?.intents ?? {}).forEach((name) => declared.add(name));
  for (const { input } of writtenScopes(ctx)) addIntents(input);
  Object.values(ctx.tasks).forEach((manifest) => addIntents(manifest.input));

  ctx.stimuliDoc.stimuli?.forEach((entry, i) => {
    for (const field of ['html', 'text']) {
      for (const match of (entry[field] ?? '').matchAll(HINT_REFERENCE)) {
        if (!declared.has(match[1])) ctx.report.error('unknown-intent-hint', FILES.stimuli, ['stimuli', i, field], `{{${match[1]}.hint}} refers to an intent that is not declared anywhere`);
      }
    }
  });
}

export function checkIntents(ctx, scopes) {
  for (const scope of scopes) {
    const block = ctx.timeline.blocks[scope.path[1]];
    checkScope(ctx, scope, block);
  }
  checkHints(ctx);
}
