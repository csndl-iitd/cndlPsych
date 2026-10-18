// Signing in to Firebase at the start of a session. The Firebase work itself is in ../remote.js.
import { askAction } from '../../authoring/modules/survey.js';
import { explainRemoteError } from '../remote.js';

// Closing or blocking the Google window is not a failure of the setup: the experimenter can try again.
const TRY_AGAIN = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/popup-blocked']);

const prompt = (note) => `## Sign in

${note ?? 'This experiment stores its data in Firebase. Sign in with your lab account to continue.'}`;

/**
 * Sign in to Firebase; controlled mode needs a click for the Google popup, and a closed or blocked
 * popup asks again instead of ending the session. Returns an error message, or null when connected.
 */
export async function signInRemote(screen, remote) {
  let note = null;
  for (;;) {
    if (remote.access === 'controlled') {
      await askAction(screen, { message: prompt(note), choices: [{ value: 'signin', text: 'Sign in' }], submitLabel: 'Continue' });
    }
    try {
      await remote.signIn();
      return null;
    } catch (error) {
      if (remote.access !== 'controlled' || !TRY_AGAIN.has(error.code)) return explainRemoteError(error, remote.config);
      note = `${explainRemoteError(error, remote.config)} Press Continue to try again.`;
    }
  }
}
