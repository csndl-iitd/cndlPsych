// Test support: Ajv validators over the generated spec/schema/*.json.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'spec', 'schema');
const BASE = 'https://example.org/cndlpsych/1/';

const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
addFormats(ajv);
for (const name of readdirSync(SCHEMA_DIR).filter((file) => file.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, name), 'utf8')));
}

/** @returns {(value: unknown) => string[]} problems found by the named schema (empty when valid) */
export function problemsFor(schemaFile, pointer = '') {
  const validate = ajv.getSchema(BASE + schemaFile + pointer);
  return (value) => {
    validate(value);
    return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
  };
}

/** Full validation of a bus event, as dev builds do on every emit. */
export const eventProblems = problemsFor('event.schema.json');
export const sessionProblems = problemsFor('session.schema.json');

export const eventSchema = JSON.parse(readFileSync(join(SCHEMA_DIR, 'event.schema.json'), 'utf8'));
