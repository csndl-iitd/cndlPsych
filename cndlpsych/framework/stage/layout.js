// The `layout` helper handed to stimulus generators (types.d.ts Layout): well-separated
// random points on the stage, and CSS to place an element at a stage point.

/**
 * @param {{rng: object, size: {w: number, h: number}, toPx: (length: number|string) => number}} options
 *   `size` is the stage in CSS px; `toPx` converts a YAML length (bare = fraction of the shorter side).
 */
export function createLayout({ rng, size, toPx }) {
  return {
    /** n points (stage coordinates) at least minDistance apart and margin from the edge; throws if they cannot fit. */
    scatter(n, { minDistance, margin, maxAttempts = 10_000 }) {
      const gap = toPx(minDistance);
      const edge = toPx(margin);
      const width = size.w - 2 * edge;
      const height = size.h - 2 * edge;
      if (width <= 0 || height <= 0) throw new RangeError(`margin ${margin} leaves no room on a ${size.w} x ${size.h} stage`);
      const placed = [];
      for (let attempt = 0; placed.length < n; attempt += 1) {
        if (attempt >= maxAttempts) {
          throw new RangeError(`could not place ${n} points at least ${minDistance} apart after ${maxAttempts} draws (placed ${placed.length}); use fewer items or a smaller distance`);
        }
        const candidate = { x: edge + rng.next() * width, y: edge + rng.next() * height };
        if (placed.every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) >= gap)) placed.push(candidate);
      }
      return placed.map((p) => ({ x: p.x / size.w, y: p.y / size.h }));
    },

    /** Inline CSS centring an element on a stage point (the element's offset parent is the stage). */
    at: (point) => `left:${round(point.x * 100)}%;top:${round(point.y * 100)}%;`,

    get size() { return { ...size }; },
  };
}

const round = (value) => Math.round(value * 1e4) / 1e4;
