// Test support: a manual clock and scheduler. Advancing time runs due timers in order and
// lets pending promises settle, so async code (queues, retries) can be tested exactly.

const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

export function createFakeTime() {
  const time = { now: 0, timers: [] };
  const fake = {
    clock: { now: () => time.now, toWall: (t) => 1_790_000_000_000 + t },
    schedule(ms, callback) {
      const timer = { at: time.now + ms, callback, cancelled: false };
      time.timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    get now() { return time.now; },
    set now(value) { time.now = value; },
    settle,
    /** Advance by `ms`, firing timers that fall due, in order. */
    async advance(ms) {
      const target = time.now + ms;
      for (;;) {
        await settle();
        const due = time.timers.filter((t) => !t.cancelled && t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        time.now = due.at;
        due.cancelled = true;
        due.callback();
      }
      time.now = target;
      await settle();
    },
    get pendingTimers() { return time.timers.filter((t) => !t.cancelled).length; },
  };
  return fake;
}
