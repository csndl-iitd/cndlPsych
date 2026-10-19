// Frame-locked timing. Durations count display frames, and the end of a phase happens inside the
// animation-frame callback of the frame that completes it. Whatever the experiment does next in
// the same synchronous run (starting the next phase, which draws it) is therefore painted in that
// same frame, with no gap and no extra rounding. The timestamp of that frame stamps the offset of
// one phase and the onset of the next, and is what the photodiode and the trigger rule see.
//
// What this cannot do: make a frame arrive on time. If the main thread is blocked, a frame is
// late and the phase ends on the late frame (it shows as a longer `frames` in phase.offset). The
// browser gives a late callback the timestamp of the frame it was meant for, which can be many frames
// old, so every timestamp handed out here is corrected by the whole frames the callback ran late. Each
// phase is aimed at its own actual onset, so every phase still gets its full number of frames and a
// late frame delays what follows by that much instead of shortening it.

/**
 * @param {{requestFrame?: (callback: (timestamp: number) => void) => number, cancelFrame?: (handle: number) => void, schedule?: (ms: number, callback: () => void) => (() => void), frameMs?: number}} [options]
 *   `frameMs` is the starting frame time; `setFrameMs` updates it once it is measured.
 */
export function createFrames({
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (handle) => globalThis.cancelAnimationFrame(handle),
  schedule = (ms, callback) => { const handle = setTimeout(callback, ms); return () => clearTimeout(handle); },
  frameMs: initialFrameMs = 1000 / 60,
  now = () => performance.now(),
} = {}) {
  let frameMs = initialFrameMs;
  let handle = null;
  let jobs = [];
  let current = null; // timestamp of the frame being run, until the macrotask after it
  let clearCurrent = null;

  function runFrame(rawTimestamp) {
    handle = null;
    // A callback that runs k whole frames late belongs to a frame that effectively starts k frames after its timestamp.
    const timestamp = rawTimestamp + frameMs * Math.max(0, Math.floor((now() - rawTimestamp) / frameMs));
    current = timestamp;
    clearCurrent?.();
    // Jobs run in target order; a job may add jobs, which are looked at on the next frame.
    const due = jobs.filter((job) => job.target - frameMs / 2 <= timestamp).sort((a, b) => a.target - b.target);
    jobs = jobs.filter((job) => !due.includes(job));
    for (const job of due) job.run(timestamp);
    // The microtasks that follow this callback (jsPsych moving on to the next trial) still belong to
    // this frame; the next macrotask does not.
    clearCurrent = schedule(0, () => { current = null; clearCurrent = null; });
    if (jobs.length) handle = requestFrame(runFrame);
  }

  function ensureRunning() {
    if (handle === null) handle = requestFrame(runFrame);
  }

  return {
    get frameMs() { return frameMs; },
    setFrameMs(ms) { frameMs = ms; },

    /** Number of whole frames closest to a duration (at least one). */
    framesFor: (ms) => Math.max(1, Math.round(ms / frameMs)),

    /**
     * The timestamp of the frame whose callback is running now, or null outside one. It stays
     * set for the synchronous and microtask work that follows, until the next macrotask.
     */
    get frameTimestamp() { return current; },

    /**
     * Call `callback(timestamp)` in the first frame at or after `count` frames past `from` (a frame
     * timestamp). The frame is chosen by timestamp, not by counting callbacks, so a dropped frame
     * cannot push later targets back.
     * @returns {() => void} cancels it
     */
    after(from, count, callback) {
      const job = { target: from + count * frameMs, run: callback };
      jobs.push(job);
      ensureRunning();
      return () => {
        jobs = jobs.filter((other) => other !== job);
        if (!jobs.length && handle !== null) {
          cancelFrame(handle);
          handle = null;
        }
      };
    },

    /** The next frame's timestamp (what `nextFrame` gives, through the same loop). */
    next() {
      return new Promise((resolve) => {
        const job = { target: -Infinity, run: resolve };
        jobs.push(job);
        ensureRunning();
      });
    },
  };
}
