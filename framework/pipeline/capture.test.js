import { describe, expect, it } from 'vitest';
import { createFakeTime } from '../../tools/fake-time.js';
import { createCapture } from './capture.js';

const chunk = (sink, dir, t, ...bytes) => ({ sink, dir, t, bytes: Uint8Array.from(bytes) });
const fakeStore = (firstSegment = 1) => {
  const pieces = [];
  return { pieces, addStream: async (piece) => { pieces.push(piece); }, nextStreamSegment: async () => firstSegment };
};

describe('raw capture', () => {
  it('keeps chunks in order as one batch a second, with each chunk\'s sink, direction, time and length', async () => {
    const time = createFakeTime();
    const store = fakeStore();
    const capture = createCapture({ schedule: time.schedule });
    capture.attach(store);
    capture.add(chunk('rx', 'rx', 10, 1, 2, 3));
    capture.add(chunk('rx', 'tx', 12, 9));
    await time.advance(999);
    expect(store.pieces).toEqual([]);
    await time.advance(1);
    expect(store.pieces).toEqual([{ segment: 1, index: 0, chunks: [{ sink: 'rx', dir: 'rx', t: 10, n: 3 }, { sink: 'rx', dir: 'tx', t: 12, n: 1 }], data: Uint8Array.from([1, 2, 3, 9]) }]);
    capture.add(chunk('rx', 'rx', 2000, 5));
    await capture.flush();
    expect(store.pieces[1]).toMatchObject({ segment: 1, index: 1, data: Uint8Array.from([5]) });
  });

  it('holds what arrives before a store is attached and writes it when one is; a resumed session starts the next segment', async () => {
    const time = createFakeTime();
    const capture = createCapture({ schedule: time.schedule });
    capture.add(chunk('a', 'rx', 1, 7));
    await time.advance(5000);
    const store = fakeStore(3);
    capture.attach(store);
    await time.advance(1000);
    expect(store.pieces).toEqual([{ segment: 3, index: 0, chunks: [{ sink: 'a', dir: 'rx', t: 1, n: 1 }], data: Uint8Array.from([7]) }]);
  });

  it('counts per sink and direction, writes nothing when nothing arrived, and reports a store that fails', async () => {
    const time = createFakeTime();
    const errors = [];
    const capture = createCapture({ schedule: time.schedule, onError: (error) => errors.push(error.message) });
    capture.attach({ addStream: async () => { throw new Error('disk full'); } });
    await capture.flush();
    expect(errors).toEqual([]);
    capture.add(chunk('a', 'rx', 1, 1, 2));
    capture.add(chunk('a', 'rx', 2, 3));
    capture.add(chunk('a', 'tx', 3, 4));
    expect(capture.totals('a')).toEqual({ rx_chunks: 2, rx_bytes: 3, tx_chunks: 1, tx_bytes: 1 });
    expect(capture.totals('b')).toBeUndefined();
    await capture.flush();
    expect(errors).toEqual(['disk full']);
  });

  it('ignores a store that cannot keep streams', async () => {
    const time = createFakeTime();
    const capture = createCapture({ schedule: time.schedule });
    capture.attach({});
    capture.add(chunk('a', 'rx', 1, 1));
    await time.advance(5000);
    await expect(capture.flush()).resolves.toBeUndefined();
  });
});
