// Is a session read back from storage complete? (spec/firebase/DESIGN.md, "Export contract")
// Shared by the Firestore export and anything else that reads chunked sessions.
import { readChunks } from './chunks.js';

/**
 * @param {object} session the session document
 * @param {object[]} chunks its chunk documents, in any order
 * @returns {Promise<{events: object[], partial: boolean, issues: string[]}>}
 *   `partial` is true when the session never finished or the chunks do not add up to what it
 *   says it wrote; the events are still returned, so an interrupted session stays exportable.
 */
export async function integrityReport(session, chunks) {
  const { events, issues } = await readChunks(chunks);
  const found = new Set(chunks.map((chunk) => chunk.i));
  if (session.status === 'in_progress') issues.push('the session never finished (interrupted)');
  if (session.n_chunks === undefined) {
    if (session.status !== 'in_progress') issues.push('the session record does not say how many chunks it wrote');
  } else {
    for (let i = 0; i < session.n_chunks; i += 1) if (!found.has(i)) issues.push(`chunk ${i} of ${session.n_chunks} is missing`);
    if (found.size > session.n_chunks) issues.push(`${found.size} chunks found, the record says ${session.n_chunks}`);
  }
  if (session.last_seq !== undefined && events.length && events.at(-1).seq !== session.last_seq) {
    issues.push(`the last event is seq ${events.at(-1).seq}, the record says ${session.last_seq}`);
  }
  return { events, partial: issues.some((issue) => !issue.startsWith('duplicate chunk')), issues };
}
