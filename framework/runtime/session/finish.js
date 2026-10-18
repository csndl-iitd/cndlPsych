// The end of a session: closing the record, the export download, and the final screen. A session
// ends one of three ways: completed, stopped early (an error or an abort), or refused at the
// device check (that one is handled where the check happens).
import { isoNow } from '../../foundation/clock.js';
import { finishSessionRecord } from '../../foundation/session.js';
import { sessionArchive, SUPPORTED_FORMATS, webcamFiles } from '../../storage/export.js';
import { downloadFile } from '../download.js';
import { showMessage } from './messages.js';

/**
 * A function that closes the session record with a reason and hands it to the store.
 * @param {{record: object, store: object, bus: object, extras?: () => object}} options
 *   `extras` returns fields to add to the record at the end (eye tracking's summary)
 * @returns {(reason: string) => Promise<object>} resolves with the final record
 */
export const createFinisher = ({ record, store, bus, extras = () => ({}) }) => async (reason) => {
  const done = finishSessionRecord({ ...record, ...extras() }, { reason, endedAt: isoNow(), lastSeq: bus.lastSeq });
  await store.finish(done);
  return done;
};

/** What eye tracking and the webcam recording add to the session record when it ends; `held.eye` and `held.webcam` are set by their steps. */
export const deviceExtras = (held) => () => ({
  ...(held.eye?.summary() ? { eyetracking: held.eye.summary() } : {}),
  ...(held.webcam ? { webcam: held.webcam.summary() } : {}),
});

function finishScreen(display, plan, record) {
  const { finish = {} } = plan;
  const code = finish.show_session_code ? `\n\nSession code: **${record.subject_id}_${record.session_id}**` : '';
  showMessage(display, `${finish.message ?? 'Thank you. You can close this window.'}${code}`);
  if (finish.redirect_url) {
    const delay = finish.redirect_delay === undefined ? 3000 : Number.parseFloat(finish.redirect_delay) * (String(finish.redirect_delay).endsWith('ms') ? 1 : 1000);
    setTimeout(() => globalThis.location.assign(finish.redirect_url), delay);
  }
}

/** Download the finished session as one zip, if export_on_finish asks for a format we can write. */
async function exportSession(doc, store, formats) {
  if (!formats.some((format) => SUPPORTED_FORMATS.includes(format))) return;
  const { record, events } = await store.snapshot();
  const video = await webcamFiles(record, (await store.readMedia?.()) ?? []);
  const archive = sessionArchive(record, events, formats, video);
  downloadFile(doc, { name: archive.name, data: archive.data });
}

/**
 * All blocks ran: let queued triggers go out, write session.end, close the record, export, say goodbye.
 * @returns {Promise<{status: 'complete', record: object}>}
 */
export async function completeSession({ services, project, store, finish, eye }) {
  const { plan } = project;
  const { bus, display, sinkSet } = services;
  const exportFormats = plan.storage?.local?.export_on_finish ?? [];
  await sinkSet.drain(); // triggers still queued are sent (and logged) before the session ends
  await eye.settle?.(); // so is the webcam recording: its last events come before session.end
  const unsupported = exportFormats.filter((format) => !SUPPORTED_FORMATS.includes(format));
  if (unsupported.length) {
    bus.emit({ source: 'system', type: 'system.warning', data: { code: 'export_format_unsupported', message: `export_on_finish ${unsupported.join(', ')} is not available yet and was skipped` } });
  }
  bus.emit({ source: 'system', type: 'session.end', data: { reason: 'complete' } });
  await eye.stop();
  const done = await finish('complete');
  await sinkSet.closeAll();
  await exportSession(display.ownerDocument, store, exportFormats);
  finishScreen(display, plan, done);
  return { status: 'complete', record: done };
}

/**
 * The blocks stopped early. `error.endReason === 'aborted'` is a deliberate stop (eye tracking
 * could not be validated); anything else is an error, and the session stays resumable.
 * @returns {Promise<{status: 'aborted'|'error', record: object, error: Error}>}
 */
export async function stopSession({ services, finish, eye, error }) {
  const { bus, display, sinkSet } = services;
  const reason = error.endReason ?? 'error';
  await eye.settle?.();
  if (reason === 'error') bus.emit({ source: 'system', type: 'system.error', data: { code: 'exception', message: String(error.message ?? error), fatal: true } });
  bus.emit({ source: 'system', type: 'session.end', data: { reason } });
  await eye.stop();
  const record = await finish(reason);
  await sinkSet.closeAll();
  showMessage(display, reason === 'aborted'
    ? 'The session was stopped because eye tracking could not be validated. Please tell the experimenter.'
    : 'Something went wrong and the session had to stop. Please tell the experimenter. The session can be resumed from the local data screen (add ?manage=1 to the address).');
  return { status: reason, record, error };
}
