// Upgrade a project's spec_version. There is one version so far, so this checks and reports;
// when version 2 exists, each step (n -> n+1) goes in MIGRATIONS and edits experiment.yaml in place.
//
//   node cli/migrate.js <project-dir>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dump, load } from 'js-yaml';

export const CURRENT_VERSION = 1;
/** MIGRATIONS[n] turns a version-n experiment document into a version n+1 document. */
export const MIGRATIONS = {};

/**
 * @param {object} experiment parsed experiment.yaml
 * @returns {{from: number, to: number, document: object}} the document is the upgraded copy
 */
export function migrateDocument(experiment) {
  const from = experiment.spec_version;
  if (!Number.isInteger(from) || from < 1) throw new Error('experiment.yaml has no valid spec_version');
  if (from > CURRENT_VERSION) throw new Error(`this project is spec_version ${from}, newer than this framework supports (${CURRENT_VERSION}); update cndlpsych`);
  let document = structuredClone(experiment);
  for (let version = from; version < CURRENT_VERSION; version += 1) document = { ...MIGRATIONS[version](document), spec_version: version + 1 };
  return { from, to: document.spec_version, document };
}

function main() {
  const file = join(resolve(process.argv[2] ?? '.'), 'experiment.yaml');
  const { from, to, document } = migrateDocument(load(readFileSync(file, 'utf8')));
  if (from === to) {
    console.log(`spec_version ${from} is current; nothing to do`);
    return;
  }
  writeFileSync(file, dump(document, { lineWidth: 120 }));
  console.log(`upgraded ${file} from spec_version ${from} to ${to} (comments in the YAML were not preserved; check the diff)`);
}

if (process.argv[1] === import.meta.filename) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
