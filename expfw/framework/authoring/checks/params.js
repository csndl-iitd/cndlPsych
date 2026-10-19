// Custom tasks and stimulus generators: manifests are valid, and the params written in
// YAML match what the manifest declares.
import { blockProfiles, FILES } from '../context.js';
import { compileSchema, validateAgainst } from '../spec.js';

const COMMON = 'https://example.org/expfw/1/common.schema.json#/definitions/';

function paramSchema(decl) {
  const bounds = {};
  if (decl.min !== undefined) bounds.minimum = decl.min;
  if (decl.max !== undefined) bounds.maximum = decl.max;
  switch (decl.type) {
    case 'integer': return { type: 'integer', ...bounds };
    case 'number': return { type: 'number', ...bounds };
    case 'string': case 'stimulus': case 'intent': return { type: 'string' };
    case 'boolean': return { type: 'boolean' };
    case 'duration': return { $ref: `${COMMON}duration` };
    case 'length': return { $ref: `${COMMON}length` };
    case 'enum': return { enum: decl.values };
    case 'list': return { type: 'array', items: paramSchema(decl.items) };
    default: return { type: 'object' };
  }
}

function paramsSchema(params = {}) {
  return {
    type: 'object',
    properties: Object.fromEntries(Object.entries(params).map(([name, decl]) => [name, paramSchema(decl)])),
    required: Object.entries(params).filter(([, decl]) => decl.required).map(([name]) => name),
    additionalProperties: false,
  };
}

function reportParamErrors(ctx, validate, value, file, path) {
  if (validate(value ?? {})) return;
  for (const error of validate.errors) {
    const at = error.instancePath.split('/').slice(1);
    if (error.keyword === 'additionalProperties') {
      ctx.report.error('unknown-param', file, [...path, ...at, error.params.additionalProperty], `unknown parameter "${error.params.additionalProperty}"`);
    } else if (error.keyword === 'required') {
      ctx.report.error('missing-param', file, [...path, ...at, error.params.missingProperty], `missing required parameter "${error.params.missingProperty}"`);
    } else {
      ctx.report.error('bad-param', file, [...path, ...at], `parameter ${error.message}`);
    }
  }
}

function checkManifests(ctx) {
  const groups = [
    [ctx.tasks, 'tasks', '#/definitions/task'],
    [ctx.generators, 'stimuli', '#/definitions/stimulus_generator'],
  ];
  for (const [manifests, folder, pointer] of groups) {
    for (const [name, manifest] of Object.entries(manifests)) {
      for (const { path, message } of validateAgainst(ctx.schemas, 'task-manifest.schema.json', manifest, pointer)) {
        ctx.report.error('manifest', `custom/${folder}/${name}.js`, path, message);
      }
    }
  }
}

function checkTaskBlocks(ctx) {
  ctx.timeline.blocks.forEach((block, b) => {
    const manifest = ctx.tasks[block.module];
    if (!manifest) return;
    const path = ['blocks', b];
    reportParamErrors(ctx, compileSchema(ctx.schemas, paramsSchema(manifest.params)), block.config, FILES.timeline, [...path, 'config']);
    const supported = manifest.requires?.profiles;
    for (const profile of supported ? blockProfiles(ctx, block) : []) {
      if (!supported.includes(profile)) {
        ctx.report.error('task-profile-unsupported', FILES.timeline, path, `task "${block.module}" does not support profile "${profile}" (it supports ${supported.join(', ')}); restrict the block with profiles: or skip_on:`);
      }
    }
  });
}

function checkGeneratorParams(ctx) {
  ctx.stimuliDoc.stimuli?.forEach((entry, i) => {
    const manifest = ctx.generators[entry.type];
    if (manifest) reportParamErrors(ctx, compileSchema(ctx.schemas, paramsSchema(manifest.params)), entry.params, FILES.stimuli, ['stimuli', i, 'params']);
  });
}

export function checkParams(ctx) {
  checkManifests(ctx);
  checkTaskBlocks(ctx);
  checkGeneratorParams(ctx);
}
