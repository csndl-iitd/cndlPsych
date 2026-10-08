// Display refresh rate from a run of requestAnimationFrame intervals.

const MIN_INTERVALS = 8;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * @param {number[]} intervalsMs consecutive frame-to-frame times
 * @returns {{hz: number, frameMs: number}|null} null when there are too few usable intervals.
 *   Dropped frames (intervals much longer than typical) are ignored: the median of what is left is used.
 */
export function estimateRefresh(intervalsMs) {
  const usable = intervalsMs.filter((value) => Number.isFinite(value) && value > 1);
  if (usable.length < MIN_INTERVALS) return null;
  const typical = median(usable);
  const kept = usable.filter((value) => value < typical * 1.5);
  if (kept.length < MIN_INTERVALS) return null;
  const frameMs = median(kept);
  return { hz: Number((1000 / frameMs).toFixed(1)), frameMs };
}
