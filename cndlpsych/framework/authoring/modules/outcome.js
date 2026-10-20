// The pure decisions of response_task (no jsPsych, no DOM): which intents a trial accepts,
// how `correct` is read, and how a trial's outcome is derived. Unit-tested directly.

const asList = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** Intents a trial accepts: none (default) or 'none' -> []; 'any' stays 'any'. */
export function acceptedIntents(response) {
  return asList(response).filter((intent) => intent !== 'none');
}

/** Normalise `correct` to {intents, where?} or null when the trial has no correctness rule. */
export function correctRule(correct) {
  if (correct === undefined) return null;
  if (typeof correct === 'object' && !Array.isArray(correct)) return { intents: asList(correct.intent), where: correct.where };
  return { intents: asList(correct) };
}

/**
 * trial.end outcome. Without a correctness rule: completed (responded) or none. With one:
 * timeout, else incorrect if any response or miss was wrong, else correct if any was right.
 */
export function trialOutcome({ hasRule, responses, timedOut }) {
  if (timedOut) return 'timeout';
  if (!hasRule) return responses.length ? 'completed' : 'none';
  if (responses.some((r) => r.correct === false)) return 'incorrect';
  return responses.some((r) => r.correct === true) ? 'correct' : 'none';
}
