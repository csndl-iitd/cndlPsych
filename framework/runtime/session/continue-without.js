// When something the experiment would like to use cannot be used (the trigger device, the camera, eye
// tracking), whoever runs the experiment can choose to go on without it, so the experiment stays runnable
// (a phone with no Web Serial, a camera that is blocked, a lab without the EEG connected). Participants who
// open a public link cannot: nobody is there to choose, so the experiment's own settings decide.
import { askAction } from '../../authoring/modules/survey.js';

/** Is an experimenter present? Yes, unless participants open a public Firebase link. */
export const experimenterPresent = (plan) => !(plan.storage?.firebase?.enabled === true && plan.storage.firebase.access === 'public');

/**
 * Offer to try again, continue without the feature, or stop.
 * @param {object} screen
 * @param {{feature: string, why: string, retry?: boolean}} options `feature` reads "continue without <feature>"
 * @returns {Promise<'retry'|'continue'|'stop'>}
 */
export async function askWhenUnavailable(screen, { feature, why, retry = true }) {
  const title = `${feature[0].toUpperCase()}${feature.slice(1)} could not be used`;
  return askAction(screen, {
    message: `## ${title}\n\n${why}\n\nThe experiment can be run without it: what it would have recorded or sent is missing, and the session record says so.`,
    choices: [
      ...(retry ? [{ value: 'retry', text: 'Try again' }] : []),
      { value: 'continue', text: `Continue without ${feature}` },
      { value: 'stop', text: 'Stop the session' },
    ],
  });
}
