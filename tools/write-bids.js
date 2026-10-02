// Write the BIDS files for a session (record JSON + events JSONL) into a folder.
//   node tools/write-bids.js <session.json> <events.jsonl> <out-dir>
// Defaults to the sample session in spec/examples. Used to run bids-validator by hand.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { bidsFiles } from '../framework/storage/bids.js';

const EXAMPLES = join(import.meta.dirname, '..', 'spec', 'examples');
const [sessionFile = join(EXAMPLES, 'session.sample.json'), eventsFile = join(EXAMPLES, 'events.sample.jsonl'), out = 'bids-out'] = process.argv.slice(2);
const record = JSON.parse(readFileSync(sessionFile, 'utf8'));
const events = readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
for (const file of bidsFiles([{ record, events }])) {
  const path = join(out, file.name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, file.data);
}
console.log(`wrote ${out}`);
