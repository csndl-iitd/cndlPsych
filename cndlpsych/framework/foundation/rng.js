// Seeded random streams (hard rule 5: no Math.random in framework or task code).
// mulberry32 for the stream, FNV-1a for turning (seed, label) into a child seed. Not
// cryptographic: it only needs to be reproducible and well spread.

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** @param {number} seed any integer */
export function createRng(seed) {
  const base = seed >>> 0;
  let state = base;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    /** Uniform in [0, 1). */
    next,
    /** Uniform integer in [min, max], both included. */
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new RangeError(`int(${min}, ${max}) needs integers with min <= max`);
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick from an empty list');
      return items[Math.floor(next() * items.length)];
    },
    /** A new array in random order (Fisher-Yates); the input is not changed. */
    shuffle(items) {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    /** An independent stream; depends only on this stream's seed and the label, not on how much was drawn. */
    fork: (label) => createRng(hash32(`${base}:${label}`)),
    get seed() { return base; },
  };
}
