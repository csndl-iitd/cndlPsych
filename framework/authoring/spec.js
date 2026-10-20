// Load the project files and validate them against spec/schema/*.json.
// The generated schemas are passed in (the CLI or runtime reads them), so this
// module has no file access.
import Ajv from 'ajv';
import { CORE_SCHEMA, load, types } from 'js-yaml';

const BASE = 'https://example.org/cndlpsych/1/';
// YAML 1.2: `on` stays a string key. Merge keys are kept for authors who use them.
const YAML_SCHEMA = CORE_SCHEMA.extend({ implicit: [types.merge] });

const WRAPPER_KEYWORDS = new Set(['if', 'oneOf', 'anyOf', 'not']);
const validators = new WeakMap();

export function parseYaml(text) {
  return load(text, { schema: YAML_SCHEMA });
}

function ajvFor(schemas) {
  let ajv = validators.get(schemas);
  if (!ajv) {
    // strictTypes / strictRequired only police style that the generated schemas use on purpose.
    ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, validateFormats: false });
    for (const schema of Object.values(schemas)) ajv.addSchema(schema);
    validators.set(schemas, ajv);
  }
  return ajv;
}

const decodePointer = (pointer) => pointer.split('/').slice(1)
  .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  .map((part) => (/^\d+$/.test(part) ? Number(part) : part));

function describe(error) {
  const path = decodePointer(error.instancePath);
  switch (error.keyword) {
    case 'additionalProperties':
      return { path: [...path, error.params.additionalProperty], message: `unknown key "${error.params.additionalProperty}"` };
    case 'required':
      return { path: [...path, error.params.missingProperty], message: `missing required key "${error.params.missingProperty}"` };
    case 'propertyNames':
      return { path, message: `invalid key "${error.params.propertyName}"` };
    default:
      return { path, message: error.message };
  }
}

/**
 * Validate a value against a schema file (optionally a #/definitions/x pointer).
 * @returns {{path: Array<string|number>, message: string}[]}
 */
export function validateAgainst(schemas, schemaFile, value, pointer = '') {
  const validate = ajvFor(schemas).getSchema(BASE + schemaFile + pointer);
  if (!validate) throw new Error(`no schema ${schemaFile}${pointer}`);
  if (validate(value)) return [];
  const concrete = validate.errors.filter((error) => !WRAPPER_KEYWORDS.has(error.keyword));
  return (concrete.length ? concrete : validate.errors).map(describe);
}

/** Compile a JSON Schema built at run time (e.g. from a custom task's params). */
export function compileSchema(schemas, schema) {
  return ajvFor(schemas).compile(schema);
}

/**
 * Parse one project file and validate it. Reports yaml-syntax / schema diagnostics.
 * @returns the parsed document, or undefined when it could not be parsed
 */
export function loadDocument({ file, text, schemas, schemaFile, report }) {
  let data;
  try {
    data = parseYaml(text);
  } catch (error) {
    const line = error.mark ? ` (line ${error.mark.line + 1})` : '';
    report.error('yaml-syntax', file, [], `${error.reason ?? error.message}${line}`);
    return undefined;
  }
  for (const { path, message } of validateAgainst(schemas, schemaFile, data ?? {})) {
    report.error('schema', file, path, message);
  }
  return data ?? {};
}
