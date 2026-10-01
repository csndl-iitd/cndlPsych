// Build spec/schema/*.json from the YAML sources in spec/src/.
//
//   src/*.schema.yaml       -> schema/<name>.schema.json  (x-* keys stripped, anchors expanded)
//   src/events.catalog.yaml -> schema/event.schema.json   (envelope + one data schema per event type)
//
// Usage: node spec/tools/build.js [--check]
// --check writes nothing and fails if a generated file differs from its source.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadYaml } from './yaml12.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'schema');
const DRAFT = 'http://json-schema.org/draft-07/schema#';
const BASE = 'https://example.org/expfw/1/';
const NAME_PATTERN = '[a-z0-9_]+(\\.[a-z0-9_]+)*';

/** Remove x-* helper keys (used for YAML anchors) recursively. */
export function stripExtensions(node) {
  if (Array.isArray(node)) return node.map(stripExtensions);
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !key.startsWith('x-'))
        .map(([key, value]) => [key, stripExtensions(value)]),
    );
  }
  return node;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function typeCondition(key) {
  if (!key.endsWith('.*')) return { properties: { type: { const: key } }, required: ['type'] };
  const prefix = escapeRegex(key.slice(0, -2));
  return { properties: { type: { pattern: `^${prefix}\\.${NAME_PATTERN}$` } }, required: ['type'] };
}

function dataSchema(spec) {
  const data = {
    type: 'object',
    properties: spec.data ?? {},
    additionalProperties: Boolean(spec.open),
  };
  if (spec.required?.length) data.required = spec.required;
  return data;
}

export function buildEvents(catalog) {
  const types = catalog.events;
  const keys = Object.keys(types);
  const exact = keys.filter((key) => !key.endsWith('.*'));
  const wildcards = keys.filter((key) => key.endsWith('.*')).map((key) => key.slice(0, -2));

  const allOf = keys.map((key) => ({
    if: typeCondition(key),
    then: { properties: { source: { const: types[key].source }, data: dataSchema(types[key]) } },
  }));
  const anyOf = [
    { properties: { type: { enum: exact } } },
    ...wildcards.map((w) => ({ properties: { type: { pattern: `^${escapeRegex(w)}\\.${NAME_PATTERN}$` } } })),
  ];

  return {
    $schema: DRAFT,
    $id: `${BASE}event.schema.json`,
    title: 'Bus event',
    description: 'Generated from src/events.catalog.yaml - do not edit by hand.',
    type: 'object',
    required: ['v', 'seq', 't', 'source', 'type', 'data'],
    additionalProperties: false,
    properties: {
      v: { const: 1 },
      seq: { type: 'integer', minimum: 0 },
      t: { type: 'number', description: "source time, ms on the page's monotonic clock" },
      t_bus: { type: 'number' },
      source: { enum: catalog.envelope.sources },
      type: { type: 'string', pattern: '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$' },
      data: { type: 'object' },
      block: { type: ['string', 'null'] },
      trial: { type: ['integer', 'null'], minimum: 1 },
      phase: { type: ['string', 'null'] },
      caused_by: { type: ['integer', 'null'], minimum: 0 },
    },
    definitions: catalog.defs,
    anyOf,
    allOf,
  };
}

const serialize = (schema) => `${JSON.stringify(schema, null, 2)}\n`;

/** Returns Map<file name, file content> for every generated schema. */
export function buildAll(srcDir = SRC) {
  const built = new Map();
  const sources = readdirSync(srcDir).filter((name) => name.endsWith('.schema.yaml')).sort();
  for (const name of sources) {
    const schema = stripExtensions(loadYaml(readFileSync(join(srcDir, name), 'utf8')));
    const outName = name.replace('.yaml', '.json');
    if (schema.$id !== BASE + outName) throw new Error(`${name}: $id ${schema.$id} != ${BASE + outName}`);
    built.set(outName, serialize(schema));
  }
  const catalog = loadYaml(readFileSync(join(srcDir, 'events.catalog.yaml'), 'utf8'));
  built.set('event.schema.json', serialize(buildEvents(catalog)));
  return built;
}

function main() {
  const check = process.argv.includes('--check');
  const built = buildAll();
  let stale = 0;
  if (!check) mkdirSync(OUT, { recursive: true });
  for (const [name, content] of built) {
    const path = join(OUT, name);
    if (check) {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (current !== content) {
        stale += 1;
        console.error(`stale: spec/schema/${name}`);
      }
    } else {
      writeFileSync(path, content);
      console.log(`built spec/schema/${name}`);
    }
  }
  if (stale) {
    console.error('Generated schemas differ from spec/src; run npm run build:schemas');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
