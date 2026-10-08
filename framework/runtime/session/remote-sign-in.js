// Signing in to Firebase at the start of a session. The Firebase work itself is in ../remote.js.
import { askAction } from '../../authoring/modules/survey.js';

/** Sign in to Firebase; controlled mode needs a click for the Google popup. Returns an error message, or null when connected. */
export async function signInRemote(screen, remote) {
  if (remote.access === 'controlled') {
    await askAction(screen, { message: `## Sign in

This experiment stores its data in Firebase. Sign in with your lab account to continue.`, choices: [{ value: 'signin', text: 'Sign in' }], submitLabel: 'Continue' });
  }
  try {
    await remote.signIn();
    return null;
  } catch (error) {
    return String(error.message ?? error);
  }
}
