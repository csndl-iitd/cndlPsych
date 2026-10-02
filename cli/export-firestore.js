// Export an experiment's sessions from Firestore as a BIDS dataset (spec/firebase/DESIGN.md,
// "Export contract"). It reads with the Admin SDK, which bypasses the security rules, so it
// needs a service account (or the emulator).
//
//   node cli/export-firestore.js --project <id> --experiment <experiment_id> --out <dir>
//        [--key service-account.json] [--emulator host:port]
//
// Every session is checked (missing chunks, seq gaps, sessions that never finished). An
// incomplete session is still exported, with an INCOMPLETE.txt next to its data, and the
// summary printed here and written to sourcedata/export-report.json lists every problem.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { bidsFiles } from '../framework/storage/bids.js';
import { integrityReport } from '../framework/storage/integrity.js';

/**
 * @param {object} db a Firestore (Admin SDK) instance
 * @param {string} experimentId
 * @returns {Promise<{record: object, events: object[], issues: string[], partial: boolean, path: string}[]>} oldest session first
 */
export async function readSessions(db, experimentId) {
  const snapshot = await db.collectionGroup('sessions').where('experiment_id', '==', experimentId).get();
  const sessions = await Promise.all(snapshot.docs.map(async (doc) => {
    const record = doc.data();
    const chunks = (await doc.ref.collection('chunks').orderBy('i').get()).docs.map((chunk) => chunk.data());
    const report = await integrityReport(record, chunks);
    return { record, events: report.events, issues: report.issues, partial: report.partial, path: doc.ref.path };
  }));
  return sessions.sort((a, b) => String(a.record.started_at).localeCompare(String(b.record.started_at)));
}

/** The dataset files for these sessions, plus an export report under sourcedata/. */
export function datasetFiles(sessions, experimentId) {
  const report = {
    experiment_id: experimentId,
    sessions: sessions.map(({ record, events, issues, partial, path }) => ({
      path, subject_id: record.subject_id, session_id: record.session_id, status: record.status, n_events: events.length, partial, issues,
    })),
  };
  return [...bidsFiles(sessions), { name: 'sourcedata/export-report.json', data: `${JSON.stringify(report, null, 2)}\n` }];
}

export function writeFiles(out, files) {
  for (const file of files) {
    const path = join(out, file.name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.data);
  }
}

async function openFirestore({ project, key, emulator }) {
  if (emulator) process.env.FIRESTORE_EMULATOR_HOST = emulator;
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const credential = key ? cert(JSON.parse(readFileSync(key, 'utf8'))) : undefined;
  return getFirestore(initializeApp({ projectId: project, ...(credential ? { credential } : {}) }));
}

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: 'string' }, experiment: { type: 'string' }, out: { type: 'string' }, key: { type: 'string' }, emulator: { type: 'string' },
  } });
  if (!values.project || !values.experiment || !values.out) {
    console.error('usage: node cli/export-firestore.js --project <id> --experiment <experiment_id> --out <dir> [--key service-account.json] [--emulator host:port]');
    process.exit(2);
  }
  const sessions = await readSessions(await openFirestore(values), values.experiment);
  writeFiles(values.out, datasetFiles(sessions, values.experiment));
  const partial = sessions.filter((session) => session.partial);
  console.log(`${sessions.length} session(s) exported to ${values.out}; ${partial.length} incomplete`);
  for (const { record, issues } of partial) console.log(`  ${record.subject_id}_${record.session_id}: ${issues.join('; ')}`);
  process.exit(0);
}

if (process.argv[1] === import.meta.filename) main();
