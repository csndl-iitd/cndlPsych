// Test support: an in-memory virtual serial pair. What one end writes, the other end receives
// (like two ends of a null-modem cable). It stands in for a pair of real virtual COM ports.
export function createVirtualSerialPair() {
  const received = { a: [], b: [] };
  const listeners = { a: [], b: [] };
  let closed = false;

  const end = (name, other) => ({
    /** Write bytes; the other end receives them. */
    write: async (bytes) => {
      if (closed) throw new Error('port closed');
      const copy = Uint8Array.from(bytes);
      received[other].push(...copy);
      listeners[other].forEach((listener) => listener(copy));
    },
    close: async () => { closed = true; },
    onData: (listener) => listeners[name].push(listener),
    /** Everything this end has received so far. */
    get received() { return [...received[name]]; },
  });

  return { a: end('a', 'b'), b: end('b', 'a') };
}
