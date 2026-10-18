// Recovery of sessions that were interrupted (tab closed, browser or computer crashed). It
// runs before consent, so it never records anything about the new participant. An
// interrupted session can be resumed (same participant, same seed, carrying on where it
// stopped), downloaded as it is, or deleted.
import { askAction } from '../authoring/modules/survey.js';
import { sessionArchive } from '../storage/export.js';
import { downloadFile, downloadWebcamVideo } from './download.js';

/**
 * @param {{
 *   screen: object, store: object, policy: 'offer'|'auto'|'off', formats: string[], doc: Document,
 *   check: (item: object) => Promise<{ok: boolean, reason?: string}>,
 * }} options `check(item)` says whether the session can be resumed here
 * @returns {Promise<{found: number, downloaded: number, deleted: number, resume?: object}>}
 *   `resume` is the stored session the user chose to continue (offer policy only)
 */
export async function recoverSessions({ screen, store, policy, formats, doc, check }) {
  const result = { found: 0, downloaded: 0, deleted: 0 };
  if (policy === 'off' || typeof store.findUnfinished !== 'function') return result;

  const unfinished = await store.findUnfinished();
  result.found = unfinished.length;

  async function download(item) {
    const record = await store.abandon(item.key);
    const { events } = await store.read(item.key);
    const archive = sessionArchive(record, events, formats.length ? formats : ['jsonl']);
    await downloadWebcamVideo(doc, store, record, item.key);
    downloadFile(doc, { name: `recovered_${archive.name}`, data: archive.data });
    result.downloaded += 1;
  }

  for (const item of unfinished) {
    if (policy === 'auto') {
      await download(item);
      continue;
    }
    const { subject_id: subject, session_id: sessionId, started_at: started } = item.record;
    const verdict = await check(item);
    const resumeNote = verdict.ok
      ? 'It can be **resumed**: it carries on where it stopped (the trial that was running starts again).'
      : `It cannot be resumed: ${verdict.reason}`;
    const choice = await askAction(screen, {
      message: `## An unfinished session was found\n\nParticipant **${subject}**, session **${sessionId}**, started ${started}: ${item.lastSeq + 1} events were saved. This usually means the page was closed or crashed during a session.\n\n${resumeNote}`,
      choices: [
        ...(verdict.ok ? [{ value: 'resume', text: 'Resume this session' }] : []),
        { value: 'download', text: 'Download its data' },
        { value: 'delete', text: 'Delete it' },
        { value: 'keep', text: 'Keep it for now' },
      ],
    });
    if (choice === 'resume') return { ...result, resume: item };
    if (choice === 'download') await download(item);
    if (choice === 'delete') {
      await store.remove(item.key);
      result.deleted += 1;
    }
  }
  return result;
}
