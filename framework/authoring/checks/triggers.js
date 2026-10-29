// Triggers and events: `on` / `where` refer to real events and fields, values fit their
// sinks, and no value carries two meanings or fires twice by accident.
import { FILES, writtenScopes } from '../context.js';
import { sinkProblems } from '../../foundation/format.js';
import { isGenerated } from '../universal-triggers.js';

const ENVELOPE_FIELDS = new Set(['block', 'trial', 'phase']);
const COMBINATORS = ['all', 'any', 'not'];
const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function* inputRules(scope) {
  for (const [profile, profileScope] of Object.entries(scope?.profiles ?? {})) {
    for (const [i, rule] of (profileScope.rules ?? []).entries()) yield { rule, path: ['profiles', profile, 'rules', i] };
  }
}

/** Events that exist because of project content: semantic.<intent>, emitted events, declared task events. */
function projectEvents(ctx) {
  const names = new Set();
  const addInput = (scope) => {
    Object.keys(scope?.intents ?? {}).forEach((intent) => names.add(`semantic.${intent}`));
    for (const { rule } of inputRules(scope)) asList(rule.emit).forEach((item) => item.event && names.add(item.event));
  };
  for (const { input } of writtenScopes(ctx)) addInput(input);
  for (const manifest of Object.values(ctx.tasks)) {
    addInput(manifest.input);
    manifest.events?.forEach((event) => names.add(event));
  }
  for (const manifest of Object.values(ctx.generators)) manifest.events?.forEach((event) => names.add(event));
  return names;
}

function eventInfo(ctx, projectNames, on) {
  const { exact, families } = ctx.events;
  if (on.endsWith('.*')) {
    const prefix = on.slice(0, -1);
    const found = [...exact.keys()].some((name) => name.startsWith(prefix)) || [...families.keys()].some((f) => `${f}.`.startsWith(prefix) || prefix.startsWith(`${f}.`));
    return found ? { known: true, open: true } : { known: false };
  }
  if (exact.has(on)) return { known: true, ...exact.get(on) };
  const family = [...families.keys()].find((name) => on.startsWith(`${name}.`));
  return family && projectNames.has(on) ? { known: true, open: true } : { known: false };
}

function checkWhereKeys(ctx, info, where, file, path, event) {
  for (const [key, value] of Object.entries(where ?? {})) {
    if (key === 'not') checkWhereKeys(ctx, info, value, file, [...path, key], event);
    else if (COMBINATORS.includes(key)) value.forEach((inner, i) => checkWhereKeys(ctx, info, inner, file, [...path, key, i], event));
    else if (!info.open && !info.fields.has(key.split('.')[0]) && !ENVELOPE_FIELDS.has(key)) {
      ctx.report.error('unknown-where-key', file, [...path, key], `event ${event} has no field "${key}"`);
    }
  }
}

function checkEvent(ctx, projectNames, { on, where }, file, path) {
  const info = eventInfo(ctx, projectNames, on);
  if (!info.known) {
    ctx.report.error('unknown-event', file, [...path, 'on'], `"${on}" is not a framework event, a semantic.<intent> event, or a task event declared by a custom task or emitted by a rule`);
    return;
  }
  checkWhereKeys(ctx, info, where, file, [...path, 'where'], on);
}

function checkEventNames(ctx) {
  const projectNames = projectEvents(ctx);
  for (const { file, path, input, triggers } of writtenScopes(ctx)) {
    (triggers?.rules ?? []).forEach((rule, i) => {
      if (rule.on) checkEvent(ctx, projectNames, rule, file, [...path, 'triggers', 'rules', i]);
    });
    for (const { rule, path: rulePath } of inputRules(input)) {
      const steps = rule.match?.sequence ?? (rule.match ? [rule.match] : []);
      const matchPath = [...path, 'input', ...rulePath, 'match'];
      steps.forEach((step, s) => checkEvent(ctx, projectNames, step, file, rule.match.sequence ? [...matchPath, 'sequence', s] : matchPath));
    }
  }
}

function literalValues(rule) {
  const { value } = rule;
  if (Number.isInteger(value)) return [{ value, path: ['value'] }];
  if (value?.map) {
    const values = Object.entries(value.map.table).map(([key, v]) => ({ value: v, path: ['value', 'map', 'table', key] }));
    return value.map.default === undefined ? values : [...values, { value: value.map.default, path: ['value', 'map', 'default'] }];
  }
  return [];
}

function checkRanges(ctx) {
  const rawSinks = new Set(ctx.sinks.filter((sink) => sink.format === 'raw').map((sink) => sink.id));
  if (rawSinks.size === 0) return;
  const hitsRaw = (rule) => (rule.sinks ?? [...rawSinks]).some((id) => rawSinks.has(id));
  const fail = (file, path, value) => ctx.report.error('value-out-of-range', file, path, `trigger value ${value} does not fit a raw sink (0-255)`);

  for (const { file, path, triggers } of writtenScopes(ctx)) {
    (triggers?.rules ?? []).forEach((rule, i) => {
      if (!hitsRaw(rule)) return;
      for (const { value, path: valuePath } of literalValues(rule)) {
        if (value > 255) fail(file, [...path, 'triggers', 'rules', i, ...valuePath], value);
      }
    });
  }
  for (const { stimulus, path, index } of ctx.expanded) {
    if (stimulus.trigger > 255) fail(FILES.stimuli, [...path, index === undefined ? 'trigger' : 'trigger_base'], stimulus.trigger);
  }
}

const sinksOf = (rule, allSinks) => rule.sinks ?? allSinks;
const shareSink = (a, b, allSinks) => sinksOf(a, allSinks).some((id) => sinksOf(b, allSinks).includes(id));

function eventsOverlap(a, b) {
  if (a === b) return true;
  const covers = (glob, name) => glob.endsWith('.*') && name.startsWith(glob.slice(0, -1));
  return covers(a, b) || covers(b, a);
}

const sameMeaning = (a, b) => a.on === b.on && JSON.stringify(a.where ?? null) === JSON.stringify(b.where ?? null);

function checkResolved(ctx, scope, reported) {
  if (!scope.triggers.enabled) return;
  const allSinks = ctx.sinks.map(({ id }) => id);
  const rules = scope.triggers.rules.filter((rule) => rule.on && rule.value !== undefined);
  const once = (code, message) => {
    const key = `${code}|${message}`;
    if (reported.has(key)) return;
    reported.add(key);
    (['double-fire', 'trigger-value-reserved'].includes(code) ? ctx.report.warn : ctx.report.error)(code, scope.file, scope.path, message);
  };

  rules.forEach((a, i) => {
    for (const b of rules.slice(i + 1)) {
      if (!shareSink(a, b, allSinks)) continue;
      const values = Number.isInteger(a.value) && Number.isInteger(b.value);
      if (values && a.value === b.value && !sameMeaning(a, b)) {
        if (isGenerated(a) && isGenerated(b)) once('value-collision', `trigger value ${a.value} is used by rules "${a.id}" and "${b.id}" for different events`);
        else if (isGenerated(a) || isGenerated(b)) once('trigger-value-reserved', `trigger value ${a.value} is used by rule "${(isGenerated(a) ? b : a).id}" and also by the built-in rule "${(isGenerated(a) ? a : b).id}"; use another value (1-10 are for universal triggers, semantic triggers count up from 11)`);
        else once('value-collision', `trigger value ${a.value} is used by rules "${a.id}" and "${b.id}" for different events`);
      }
      const compatible = !a.where || !b.where || JSON.stringify(a.where) === JSON.stringify(b.where);
      if (eventsOverlap(a.on, b.on) && compatible && !a.allow_multiple && !b.allow_multiple) {
        once('double-fire', `rules "${a.id}" and "${b.id}" can fire on the same event; set allow_multiple on one of them if that is intended`);
      }
    }
  });
}

/** Sink settings that cannot work together, and templates that cannot be rendered. */
function checkSinkSettings(ctx) {
  ctx.sinks.forEach((sink, i) => {
    const at = (key) => ['triggers', 'sinks', i, key];
    for (const message of sinkProblems(sink)) ctx.report.error('bad-sink-template', FILES.experiment, at('template'), `sink "${sink.id}": ${message}`);
    if (sink.sync && sink.type !== 'websocket') ctx.report.error('sink-sync-unsupported', FILES.experiment, at('sync'), `sink "${sink.id}": ping sync needs a websocket receiver that replies`);
    if (sink.ack && sink.type === 'usb') ctx.report.error('sink-ack-unsupported', FILES.experiment, at('ack'), `sink "${sink.id}": USB sinks cannot receive acknowledgements`);
    if (sink.capture?.raw && ctx.experiment.storage?.firebase?.enabled) ctx.report.warn('capture-not-uploaded', FILES.experiment, at('capture'), `sink "${sink.id}": the raw device data is kept in the browser and added to the downloaded zip; it is not uploaded to Firebase, which stores the events only`);
    if (sink.reset_after_ms !== undefined && sink.format !== 'raw') ctx.report.error('sink-reset-needs-raw', FILES.experiment, at('reset_after_ms'), `sink "${sink.id}": reset_after_ms only applies to format raw`);
  });
}

export function checkTriggers(ctx, scopes) {
  checkSinkSettings(ctx);
  checkEventNames(ctx);
  checkRanges(ctx);
  const reported = new Set();
  for (const scope of scopes) checkResolved(ctx, scope, reported);
}
