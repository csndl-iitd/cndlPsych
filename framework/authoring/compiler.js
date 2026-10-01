// compile(project): YAML files in, one compiled plan (or diagnostics) out.
//
// project = {
//   files:   { 'experiment.yaml': text, 'timeline.yaml': text, 'stimuli.yaml'?: text, 'forms.yaml'?: text },
//   schemas: { '<name>.schema.json': object }   // the generated spec/schema/*.json
//   custom:  { tasks: {name: manifest}, stimuli: {name: manifest} }  // default exports without functions
//   assets:  string[] | null                     // project-relative file paths, to check references
// }
import { checkIntents } from './checks/intents.js';
import { checkNames } from './checks/names.js';
import { checkParams } from './checks/params.js';
import { checkReferences } from './checks/references.js';
import { checkTriggers } from './checks/triggers.js';
import { checkUnits } from './checks/units.js';
import { createContext, FILES } from './context.js';
import { CAMERA_CONSENT } from './defaults.js';
import { createReporter } from './diagnostics.js';
import { resolveBlocks } from './resolve.js';
import { loadDocument } from './spec.js';

const DOCUMENTS = [
  { key: 'experiment', file: FILES.experiment, schemaFile: 'experiment.schema.json', required: true },
  { key: 'timeline', file: FILES.timeline, schemaFile: 'timeline.schema.json', required: true },
  { key: 'stimuli', file: FILES.stimuli, schemaFile: 'stimuli.schema.json', required: false },
  { key: 'forms', file: FILES.forms, schemaFile: 'forms.schema.json', required: false },
];

function loadDocuments(project, report) {
  const docs = {};
  for (const { key, file, schemaFile, required } of DOCUMENTS) {
    const text = project.files[file];
    if (text === undefined) {
      if (required) report.error('missing-file', file, [], `${file} is required`);
      else docs[key] = {};
    } else {
      docs[key] = loadDocument({ file, text, schemas: project.schemas, schemaFile, report });
    }
  }
  return docs;
}

function assemblePlan(ctx, blocks) {
  const { input, triggers, consent, ...experiment } = ctx.experiment;
  const statements = consent.statements ?? [];
  const needsCamera = experiment.eyetracking?.enabled && !statements.some(({ id }) => id === CAMERA_CONSENT.id);
  return {
    ...experiment,
    consent: { ...consent, statements: needsCamera ? [...statements, CAMERA_CONSENT] : statements },
    triggers: { sinks: ctx.sinks, ...(triggers?.defaults ? { defaults: triggers.defaults } : {}) },
    styles: ctx.stimuliDoc.styles ?? {},
    stimuli: Object.fromEntries([...ctx.store].map(([name, { stimulus }]) => [name, stimulus])),
    forms: ctx.forms,
    blocks,
  };
}

/** @returns {{plan: object|null, diagnostics: object[], errors: object[], warnings: object[]}} */
export function compile(project) {
  const report = createReporter();
  const docs = loadDocuments(project, report);
  const result = (plan) => ({ plan: report.errors.length ? null : plan, diagnostics: report.diagnostics, errors: report.errors, warnings: report.warnings });
  if (report.errors.length) return result(null);

  const ctx = createContext({ docs, schemas: project.schemas, custom: project.custom, assets: project.assets, report });
  checkNames(ctx);
  checkReferences(ctx);
  checkParams(ctx);
  const { blocks, scopes } = resolveBlocks(ctx);
  checkIntents(ctx, scopes);
  checkTriggers(ctx, scopes);
  checkUnits(ctx);
  return result(assemblePlan(ctx, blocks));
}
