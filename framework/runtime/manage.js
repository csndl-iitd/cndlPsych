// The local data manager: every session stored in this browser, with a checkbox each (and
// "Select all"), and what to do with the selection: delete (after a confirmation), download,
// or resume one. Open it with ?manage=1 on the experiment page. It never records anything.
import { askAction, askSelection } from '../authoring/modules/survey.js';
import { deviceCaptureFiles, sessionArchive } from '../storage/export.js';
import { downloadFile, downloadWebcamVideo } from './download.js';
import { RESUMABLE_STATUSES } from './resume.js';

const STATUS_TEXT = {
  complete: 'finished',
  in_progress: 'interrupted',
  aborted: 'aborted',
  error: 'stopped by an error',
  device_rejected: 'device not allowed',
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function label({ record, lastSeq }) {
  const { status } = record;
  const resumable = RESUMABLE_STATUSES.includes(status) ? ' - can be resumed' : '';
  return `${record.subject_id}  ${record.session_id}  (${STATUS_TEXT[status] ?? status}${resumable}) - started ${record.started_at.replace('T', ' ').slice(0, 16)} - ${plural(lastSeq + 1, 'event')}`;
}

/**
 * @param {{screen: object, store: object, formats: string[], doc: Document, check: (item: object) => Promise<{ok: boolean, reason?: string}>}} options
 *   `check(item)` says whether a stored session can be resumed here (see resume.js)
 * @returns {Promise<{resume?: object, deleted: number}>} `resume` is the stored session the user chose to continue
 */
export async function manageSessions({ screen, store, formats, doc, check }) {
  const result = { deleted: 0 };
  if (typeof store.listSessions !== 'function') {
    return { ...result, unavailable: true };
  }
  let notice = '';
  for (;;) {
    const sessions = await store.listSessions();
    if (sessions.length === 0) {
      await askAction(screen, { message: `${notice}## Local data\n\nNo sessions are stored in this browser.`, choices: [{ value: 'ok', text: 'Close' }] });
      return result;
    }
    const { selected, action } = await askSelection(screen, {
      message: `${notice}## Local data\n\n${plural(sessions.length, 'session')} stored in this browser. Tick the sessions to work on (or *Select all*), choose an action, and continue.`,
      items: sessions.map((item) => ({ value: item.key, text: label(item) })),
      actions: [
        { value: 'delete', text: 'Delete the selected sessions' },
        { value: 'download', text: 'Download the selected sessions' },
        { value: 'resume', text: 'Resume the selected session (one only)' },
        { value: 'back', text: 'Close this screen' },
      ],
    });
    notice = '';
    if (action === 'back') return result;
    const chosen = sessions.filter((item) => selected.includes(item.key));
    if (chosen.length === 0) {
      notice = '**Nothing was selected.**\n\n';
      continue;
    }

    if (action === 'delete') {
      const confirmation = await askAction(screen, {
        message: `## Delete ${plural(chosen.length, 'session')}?\n\n${chosen.map((item) => `- ${item.record.subject_id} ${item.record.session_id}`).join('\n')}\n\nThis cannot be undone. Download them first if you still need the data.`,
        choices: [{ value: 'cancel', text: 'Keep them' }, { value: 'delete', text: `Delete ${plural(chosen.length, 'session')}` }],
      });
      if (confirmation === 'delete') {
        for (const item of chosen) await store.remove(item.key);
        result.deleted += chosen.length;
        notice = `**Deleted ${plural(chosen.length, 'session')}.**\n\n`;
      }
    } else if (action === 'download') {
      for (const item of chosen) {
        const { record, events } = await store.read(item.key);
        const archive = sessionArchive(record, events, formats.length ? formats : ['jsonl'], deviceCaptureFiles((await store.readStreams?.(item.key)) ?? []));
        downloadFile(doc, { name: archive.name, data: archive.data });
        await downloadWebcamVideo(doc, store, record, item.key);
      }
      notice = `**Downloaded ${plural(chosen.length, 'session')}.**\n\n`;
    } else if (chosen.length !== 1) {
      notice = '**Select exactly one session to resume.**\n\n';
    } else {
      const verdict = await check(chosen[0]);
      if (verdict.ok) return { ...result, resume: chosen[0] };
      notice = `**This session cannot be resumed:** ${verdict.reason}\n\n`;
    }
  }
}
