// Before anything about a new participant exists: sessions already stored in this browser. The
// local data screen (?manage=1) lists them; otherwise the recovery offer deals with ones that were
// interrupted. Either can end in resuming one.
import { checkResumable } from '../resume.js';
import { manageSessions } from '../manage.js';
import { recoverSessions } from '../recovery.js';
import { showMessage } from './messages.js';

/**
 * @param {object} run what the whole page run shares (see run-session.js)
 * @param {string} search the page's query string
 * @returns {Promise<{resume?: {key: string}, ended?: {status: string, deleted?: number}}>}
 *   `resume` is the stored session the user chose to continue; `ended` means the page is done (the manage screen was used)
 */
export async function chooseEarlierSession(run, search) {
  const { services, project, store, screen, env, debug } = run;
  const { plan } = project;
  const local = plan.storage?.local ?? {};
  const formats = local.export_on_finish ?? [];
  const doc = services.display.ownerDocument;

  const check = async (item) => {
    const saved = await store.read(item.key);
    if (!saved) return { ok: false, reason: 'The saved session could not be read.' };
    return checkResumable({ record: saved.record, events: saved.events, plan, specHash: project.specHash, env, override: debug.simulate_profile });
  };

  if (!new URLSearchParams(search).has('manage')) {
    const recovered = await recoverSessions({ screen, store, policy: local.recovery ?? 'offer', formats, doc, check });
    return { resume: recovered.resume };
  }
  const managed = await manageSessions({ screen, store, formats, doc, check });
  if (managed.unavailable) {
    showMessage(services.display, 'Local storage is switched off for this experiment, so there is no local data to manage.');
    return { ended: { status: 'managed' } };
  }
  if (!managed.resume) {
    showMessage(services.display, 'The local data screen is closed. Reload the page without ?manage=1 to start the experiment.');
    return { ended: { status: 'managed', deleted: managed.deleted } };
  }
  return { resume: managed.resume };
}
