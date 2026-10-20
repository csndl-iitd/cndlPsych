// The consent screen. Nothing is recorded yet: the bus drops events until recording starts.
import { showConsent } from '../../authoring/modules/survey.js';

/**
 * Ask until the participant agrees to every required statement, or declines.
 * @returns {Promise<boolean>} true when consent was given (the gate has recorded it)
 */
export async function askConsent(screen, plan, consentText, gate) {
  for (;;) {
    const answer = await showConsent(screen, { markdown: consentText ?? '', mode: plan.consent.mode, statements: plan.consent.statements });
    if (!answer.agreed) {
      gate.decline();
      return false;
    }
    if (gate.accept(answer.statements).ok) return true;
  }
}
