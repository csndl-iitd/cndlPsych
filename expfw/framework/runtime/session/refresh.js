// The display's refresh rate, measured from animation frames.
import { nextFrame } from '../../foundation/clock.js';
import { estimateRefresh } from '../../foundation/refresh.js';

const REFRESH_FRAMES = 40;

/**
 * Measure the display's frame time over about 0.7 s of animation frames. Started when the page
 * loads, so it is finished long before the session record needs it.
 * @returns {Promise<{hz: number, frameMs: number}|null>}
 */
export async function measureRefresh() {
  const stamps = [];
  for (let i = 0; i < REFRESH_FRAMES; i += 1) stamps.push(await nextFrame());
  return estimateRefresh(stamps.slice(1).map((t, i) => t - stamps[i]));
}
