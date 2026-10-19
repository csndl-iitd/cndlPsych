// Subject-number allocation (spec/firebase/DESIGN.md, "Subject-ID allocation").
//
// Pure logic over a small `ops` object, so it is unit-tested without Firestore; firebase.js
// supplies the real operations. Claims are create-only, so two clients can never hold the
// same number: the loser of a race gets a rejected write and tries again.
//
// ops: claimExists(n) -> bool, markerNumber() -> n|null (public), createPublicClaim(n, label),
//      listClaimNumbers() -> n[] (controlled), createClaim(n, label)

const RETRYABLE = new Set(['permission-denied', 'already-exists', 'aborted', 'failed-precondition']);
export const MAX_ATTEMPTS = 100;

export const subjectLabel = (n, width = 3) => `sub-${String(n).padStart(width, '0')}`;

/**
 * The first number without a claim. Public claims are contiguous, so existence is monotone:
 * gallop up from `known` (a number that is known to exist, 0 for none), then bisect.
 */
export async function firstFreeNumber(claimExists, known = 0) {
  let low = known;
  let step = 1;
  while (await claimExists(low + step)) {
    low += step;
    step *= 2;
  }
  let high = low + step;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (await claimExists(mid)) low = mid;
    else high = mid;
  }
  return high;
}

/** Retry `step` while it loses races; `wait(i)` spaces the retries so competing clients drift apart. */
async function attempt(times, step, wait) {
  let last;
  for (let i = 0; i < times; i += 1) {
    try {
      return await step(i);
    } catch (error) {
      if (!RETRYABLE.has(error?.code)) throw error;
      last = error;
      await wait?.(i);
    }
  }
  throw new Error(`could not get a subject number after ${times} attempts (${last?.code ?? 'unknown'}); try again`);
}

/**
 * Public mode: a user keeps the number they already hold (a reload never burns a number);
 * otherwise take the next free one, re-probing whenever another participant got there first.
 * @returns {Promise<{n: number, label: string, reused: boolean}>}
 */
export async function allocatePublic(ops, { width = 3, attempts = MAX_ATTEMPTS, wait } = {}) {
  const held = await ops.markerNumber();
  if (held !== null) return { n: held, label: subjectLabel(held, width), reused: true };
  let lost = 0; // the number we last lost to another participant, so it exists: resume the search above it
  return attempt(attempts, async () => {
    const known = lost && (await ops.claimExists(lost)) ? lost : 0;
    const n = await firstFreeNumber((candidate) => ops.claimExists(candidate), known);
    const label = subjectLabel(n, width);
    try {
      await ops.createPublicClaim(n, label);
    } catch (error) {
      lost = n;
      throw error;
    }
    return { n, label, reused: false };
  }, wait);
}

/** The smallest number missing from a list of claim numbers. */
export function smallestFree(numbers) {
  const taken = new Set(numbers);
  let n = 1;
  while (taken.has(n)) n += 1;
  return n;
}

/**
 * Controlled mode: the experimenter may name a number; otherwise the smallest free one is used.
 * @returns {Promise<{n: number, label: string}>}
 */
export async function allocateControlled(ops, { width = 3, override = null, attempts = MAX_ATTEMPTS, wait } = {}) {
  if (override !== null) {
    if ((await ops.listClaimNumbers()).includes(override)) throw new Error(`subject number ${override} is already taken`);
    const label = subjectLabel(override, width);
    await ops.createClaim(override, label);
    return { n: override, label };
  }
  return attempt(attempts, async () => {
    const n = smallestFree(await ops.listClaimNumbers());
    const label = subjectLabel(n, width);
    await ops.createClaim(n, label);
    return { n, label };
  }, wait);
}

/** The number a controlled-mode form should offer before the experimenter confirms or overrides it. */
export async function suggestControlled(ops, { width = 3 } = {}) {
  const n = smallestFree(await ops.listClaimNumbers());
  return { n, label: subjectLabel(n, width) };
}
