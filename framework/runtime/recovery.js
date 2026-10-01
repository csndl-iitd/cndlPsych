// Recovery of sessions that were interrupted (tab closed, browser or computer crashed). It
// runs before consent, so it never records anything about the new participant. A session is
// recovered as data, not resumed: its log is closed as `aborted` at the last event that
// reached disk, and can be downloaded or deleted.
import { askAction } from '../authoring/modules/survey.js';
import { sessionArchive } from '../storage/export.js';
import { downloadFile } from './download.js';

/**
 * @param {{screen: object, store: object, policy: 'offer'|'auto'|'off', formats: string[], doc: Document}} options
 * @returns {Promise<{found: number, downloaded: number, deleted: number}>}
 */
export async function recoverSessions({ screen, store, policy, formats, doc }) {
  const result = { found: 0, downloaded: 0, deleted: 0 };
  if (policy === 'off' || typeof store.findUnfinished !== 'function') return result;

  const unfinished = await store.findUnfinished();
  result.found = unfinished.length;

  async function download(item) {
    const record = await store.abandon(item.key);
    const { events } = await store.read(item.key);
    const archive = sessionArchive(record, events, formats.length ? formats : ['jsonl']);
    downloadFile(doc, { name: `recovered_${archive.name}`, data: archive.data });
    result.downloaded += 1;
  }

  for (const item of unfinished) {
    if (policy === 'auto') {
      await download(item);
      continue;
    }
    const { subject_id: subject, session_id: sessionId, started_at: started } = item.record;
    const choice = await askAction(screen, {
      message: `## An unfinished session was found\n\nParticipant **${subject}**, session **${sessionId}**, started ${started}: ${item.lastSeq + 1} events were saved. This usually means the page was closed or crashed during a session.\n\nThe session cannot be continued, but its data can be saved.`,
      choices: [
        { value: 'download', text: 'Download its data' },
        { value: 'delete', text: 'Delete it' },
        { value: 'keep', text: 'Keep it for now' },
      ],
    });
    if (choice === 'download') await download(item);
    if (choice === 'delete') {
      await store.remove(item.key);
      result.deleted += 1;
    }
  }
  return result;
}
