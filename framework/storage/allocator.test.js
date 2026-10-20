import { describe, expect, it } from 'vitest';
import { allocateControlled, allocatePublic, firstFreeNumber, smallestFree, subjectLabel, suggestControlled } from './allocator.js';

const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });

/** An in-memory claim table that, like the rules, rejects a number that exists or skips one. */
function fakeOps({ claims = [], marker = null, lose = 0 } = {}) {
  const table = new Set(claims);
  const state = { reads: 0, marker, losses: lose, attempts: 0 };
  return {
    state,
    table,
    async claimExists(n) { state.reads += 1; return table.has(n); },
    async markerNumber() { return state.marker; },
    async createPublicClaim(n) {
      state.attempts += 1;
      if (state.losses > 0) { state.losses -= 1; table.add(n); throw denied(); }
      if (table.has(n) || (n > 1 && !table.has(n - 1))) throw denied();
      table.add(n);
      state.marker = n;
    },
    async listClaimNumbers() { return [...table]; },
    async createClaim(n) {
      state.attempts += 1;
      if (state.losses > 0) { state.losses -= 1; table.add(n); throw denied(); }
      if (table.has(n)) throw denied();
      table.add(n);
    },
  };
}

describe('subjectLabel', () => {
  it('zero-pads to the width', () => {
    expect(subjectLabel(7)).toBe('sub-007');
    expect(subjectLabel(7, 5)).toBe('sub-00007');
    expect(subjectLabel(1234)).toBe('sub-1234');
  });
});

describe('firstFreeNumber', () => {
  it.each([0, 1, 2, 3, 4, 7, 8, 9, 100, 1023, 1024])('finds %i + 1 after %i contiguous claims', async (count) => {
    const table = new Set(Array.from({ length: count }, (_, i) => i + 1));
    expect(await firstFreeNumber(async (n) => table.has(n))).toBe(count + 1);
  });

  it('needs only O(log n) reads', async () => {
    const ops = fakeOps({ claims: Array.from({ length: 1000 }, (_, i) => i + 1) });
    await firstFreeNumber((n) => ops.claimExists(n));
    expect(ops.state.reads).toBeLessThanOrEqual(25);
  });
});

describe('allocatePublic', () => {
  it('takes number 1 first, then the next', async () => {
    const ops = fakeOps();
    expect(await allocatePublic(ops)).toEqual({ n: 1, label: 'sub-001', reused: false });
    ops.state.marker = null;
    expect((await allocatePublic(ops)).n).toBe(2);
  });

  it('re-uses the number a user already holds, so a reload burns nothing', async () => {
    const ops = fakeOps({ claims: [1, 2, 3], marker: 2 });
    expect(await allocatePublic(ops)).toEqual({ n: 2, label: 'sub-002', reused: true });
    expect(ops.state.attempts).toBe(0);
  });

  it('re-probes after losing a race', async () => {
    const ops = fakeOps({ claims: [1], lose: 2 });
    expect((await allocatePublic(ops)).n).toBe(4);
    expect(ops.state.attempts).toBe(3);
  });

  it('gives up with a clear message after too many lost races, and does not hide other errors', async () => {
    await expect(allocatePublic(fakeOps({ lose: 99 }), { attempts: 3 })).rejects.toThrow(/after 3 attempts/);
    const ops = fakeOps();
    ops.createPublicClaim = async () => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
    await expect(allocatePublic(ops)).rejects.toThrow('offline');
  });
});

describe('controlled allocation', () => {
  it('smallestFree fills gaps', () => {
    expect(smallestFree([])).toBe(1);
    expect(smallestFree([1, 2, 4])).toBe(3);
    expect(smallestFree([2, 3])).toBe(1);
  });

  it('suggests without creating anything', async () => {
    const ops = fakeOps({ claims: [1, 2] });
    expect(await suggestControlled(ops, { width: 2 })).toEqual({ n: 3, label: 'sub-03' });
    expect(ops.table.size).toBe(2);
  });

  it('creates the smallest free number, or the one the experimenter names', async () => {
    const ops = fakeOps({ claims: [1, 3] });
    expect((await allocateControlled(ops)).n).toBe(2);
    expect((await allocateControlled(ops, { override: 9 })).label).toBe('sub-009');
  });

  it('refuses a number that is taken, and retries a lost race for the suggested one', async () => {
    await expect(allocateControlled(fakeOps({ claims: [5] }), { override: 5 })).rejects.toThrow('already taken');
    expect((await allocateControlled(fakeOps({ lose: 1 }))).n).toBe(2);
  });

  it('uses a taken number again when told to, and then leaves its claim as it is', async () => {
    const ops = fakeOps({ claims: [5] });
    expect(await allocateControlled(ops, { override: 5, reuse: true })).toEqual({ n: 5, label: 'sub-005', reused: true });
    expect(ops.table.size).toBe(1);
    expect((await allocateControlled(ops, { override: 9, reuse: true })).reused).toBeUndefined(); // a free number is claimed as usual
    expect(ops.table.size).toBe(2);
  });
});
