// Generate the reference pages for the four YAML files from the JSON Schemas, so the
// documentation cannot drift from what the compiler accepts.
//
//   node tools/build-docs.js           write docs/yaml/*.md
//   node tools/build-docs.js --check   fail if the committed pages are stale
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SCHEMAS = join(ROOT, 'spec', 'schema');
const OUT = join(ROOT, 'docs', 'yaml');
const MAX_DEPTH = 7;

const PAGES = [
  { file: 'experiment', schema: 'experiment.schema.json', title: 'experiment.yaml', intro: 'Who can take part, what is stored, how responses and triggers work. Everything outside the blocks.' },
  { file: 'forms', schema: 'forms.schema.json', title: 'forms.yaml', intro: 'Questions beyond the built-in subject ID, sex, age and session ID, and any extra forms a survey block can show.' },
  { file: 'stimuli', schema: 'stimuli.schema.json', title: 'stimuli.yaml', intro: 'Everything a participant sees or hears, and the styles used by HTML stimuli.' },
  { file: 'timeline', schema: 'timeline.schema.json', title: 'timeline.yaml', intro: 'The order of blocks. What a block\'s `config` accepts depends on its `module`; those settings follow the table.',
    modules: [['instructions', 'module-instructions.schema.json'], ['response_task', 'module-response-task.schema.json'], ['survey', 'module-survey.schema.json']] },
];

const schemaCache = new Map();
const load = (file) => {
  if (!schemaCache.has(file)) schemaCache.set(file, JSON.parse(readFileSync(join(SCHEMAS, file), 'utf8')));
  return schemaCache.get(file);
};

/** Resolve a $ref relative to the file it appears in: returns {schema, file}. */
function resolveRef(ref, file) {
  const [target, pointer = ''] = ref.split('#');
  const targetFile = target || file;
  let node = load(targetFile);
  for (const part of pointer.split('/').filter(Boolean)) node = node[decodeURIComponent(part)];
  return { schema: node, file: targetFile };
}

const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
const code = (value) => `\`${oneLine(JSON.stringify(value))}\``;

function typeOf(schema, file) {
  if (schema.enum) return 'one of';
  if (schema.const !== undefined) return 'constant';
  if (schema.oneOf || schema.anyOf) return 'one of several forms';
  const type = Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type;
  if (type === 'array' && schema.items) {
    const item = expand(schema.items, file);
    return `list of ${typeOf(item.schema, item.file)}`;
  }
  return type ?? 'any';
}

function details(schema) {
  const parts = [];
  if (schema.description) parts.push(oneLine(schema.description).replace(/\.$/, ''));
  if (schema.enum) parts.push(`values: ${schema.enum.map(code).join(', ')}`);
  if (schema.const !== undefined) parts.push(`must be ${code(schema.const)}`);
  if (schema.pattern) parts.push(`pattern ${code(schema.pattern)}`);
  for (const [key, label] of [['minimum', 'min'], ['maximum', 'max'], ['minLength', 'min length'], ['minItems', 'min items'], ['maxItems', 'max items']]) {
    if (schema[key] !== undefined) parts.push(`${label} ${schema[key]}`);
  }
  return parts.join('. ');
}

/** Merge $ref targets into a node so its description, type and properties are all visible. */
function expand(schema, file) {
  if (schema.$ref) {
    const { schema: target, file: targetFile } = resolveRef(schema.$ref, file);
    const { $ref: _ref, ...own } = schema;
    const inner = expand(target, targetFile);
    return { schema: { ...inner.schema, ...own }, file: inner.file };
  }
  return { schema, file };
}

/**
 * Rows for every property under `schema`: {path, type, required, default, details}.
 * Arrays are written `name[]`; maps with free keys `name.<key>`.
 */
function rows(schemaIn, fileIn, path = '', required = false, depth = 0) {
  const { schema, file } = expand(schemaIn, fileIn);
  const here = [];
  if (path) here.push({ path, type: typeOf(schema, file), required, default: schema.default, details: details(schema) });
  if (depth >= MAX_DEPTH) return here;
  const children = [];
  const requiredKeys = new Set(schema.required ?? []);
  for (const [key, child] of Object.entries(schema.properties ?? {})) children.push(rows(child, file, path ? `${path}.${key}` : key, requiredKeys.has(key), depth + 1));
  if (schema.patternProperties) {
    for (const child of Object.values(schema.patternProperties)) children.push(rows(child, file, `${path}.<name>`, false, depth + 1));
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object' && !schema.properties) {
    children.push(rows(schema.additionalProperties, file, `${path}.<name>`, false, depth + 1));
  }
  if (schema.items && typeof schema.items === 'object') children.push(rows(schema.items, file, `${path}[]`, false, depth + 1).filter((row) => row.path !== `${path}[]`));
  for (const branch of [...(schema.allOf ?? []), ...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) {
    const sub = branch.then ?? branch;
    if (sub.properties || sub.items) children.push(rows(sub, file, path, false, depth + 1).filter((row) => row.path !== path));
  }
  const seen = new Set();
  const flat = children.flat().filter((row) => (seen.has(row.path) ? false : seen.add(row.path)));
  return [...here, ...flat];
}

function table(list) {
  if (!list.length) return '_No settings._\n';
  const lines = ['| Key | Type | Required | Default | Description |', '|---|---|---|---|---|'];
  for (const row of list) lines.push(`| \`${row.path}\` | ${row.type} | ${row.required ? 'yes' : ''} | ${row.default === undefined ? '' : code(row.default)} | ${row.details} |`);
  return `${lines.join('\n')}\n`;
}

function page({ title, intro, schema, modules }) {
  const root = load(schema);
  const parts = [
    `# ${title}`, '',
    '_Generated from the schemas in `spec/schema/` by `tools/build-docs.js`; do not edit by hand. The schemas themselves are the contract: `cndlpsych validate` reports anything outside them with the file and the path._', '',
    intro, '',
    `Paths are written as in the YAML: \`a.b\` is key \`b\` inside \`a\`; \`items[]\` is each entry of a list; \`<name>\` is a key you choose.`, '',
    table(rows(root, schema)),
  ];
  for (const [name, file] of modules ?? []) {
    parts.push(`## \`config\` of \`module: ${name}\``, '', table(rows(load(file), file)));
  }
  return `${parts.join('\n')}\n`;
}

const INDEX = `# YAML reference

One page per file, generated from the schemas. Start from \`cndlpsych init <folder>\`: the template is a complete, working experiment.

${PAGES.map((p) => `- [${p.title}](${p.file}.md) - ${p.intro.split('.')[0]}.`).join('\n')}

Custom stimuli and tasks (JavaScript in \`custom/\`) follow \`spec/types.d.ts\`.
`;

export function generate() {
  return new Map([['README.md', INDEX], ...PAGES.map((p) => [`${p.file}.md`, page(p)])]);
}

function main() {
  const check = process.argv.includes('--check');
  let stale = 0;
  if (!check) mkdirSync(OUT, { recursive: true });
  for (const [name, text] of generate()) {
    const path = join(OUT, name);
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== text) {
        stale += 1;
        console.error(`stale: docs/yaml/${name}`);
      }
    } else {
      writeFileSync(path, text);
      console.log(`wrote docs/yaml/${name}`);
    }
  }
  if (check) {
    const extra = existsSync(OUT) ? readdirSync(OUT).filter((name) => !generate().has(name)) : [];
    if (extra.length) console.error(`unexpected in docs/yaml: ${extra.join(', ')}`);
    if (stale) process.exit(1);
  }
}

if (process.argv[1] === import.meta.filename) main();
