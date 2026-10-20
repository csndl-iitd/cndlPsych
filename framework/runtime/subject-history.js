// What is known about a participant ID that was used before, from the sessions already stored under it.
// Pure: the sessions are given (from Firestore, or from this browser's own storage).

const SESSION_NUMBER = /^ses-(\d+)$/;

/**
 * The next session ID after the ones given: one more than the highest numbered one, padded like it
 * ("ses-02" after "ses-01"). "ses-01" when there are none.
 * @param {string[]} sessionIds
 * @returns {string}
 */
export function nextSessionId(sessionIds) {
  const numbers = sessionIds.map((id) => SESSION_NUMBER.exec(id)).filter(Boolean);
  if (!numbers.length) return 'ses-01';
  const width = Math.max(2, ...numbers.map((match) => match[1].length));
  return `ses-${String(Math.max(...numbers.map((match) => Number(match[1]))) + 1).padStart(width, '0')}`;
}

/**
 * @param {{session_id: string, started_at?: string, subject?: object}[]} sessions earlier sessions of one participant
 * @returns {{sessions: number, sessionIds: string[], subject: object, from?: {session_id: string, started_at?: string}, nextSession: string}}
 *   `subject` is the answers of the most recent session that has any (sex, age, ...), to fill the form with
 */
export function summarizeHistory(sessions) {
  const byTime = [...sessions].sort((a, b) => String(a.started_at ?? '').localeCompare(String(b.started_at ?? '')));
  const latest = [...byTime].reverse().find((session) => session.subject && Object.keys(session.subject).length > 0);
  const sessionIds = [...new Set(byTime.map((session) => session.session_id))];
  return {
    sessions: sessionIds.length,
    sessionIds,
    subject: latest?.subject ?? {},
    ...(latest ? { from: { session_id: latest.session_id, started_at: latest.started_at } } : {}),
    nextSession: nextSessionId(sessionIds),
  };
}

/** Sessions found in two places (Firestore and this browser) as one list, without the same session twice. */
export function mergeSessions(...lists) {
  const seen = new Set();
  return lists.flat().filter((session) => {
    const key = `${session.session_id}|${session.started_at}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
