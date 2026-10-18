// A store that keeps the session in memory. It is the storage used when local storage is
// disabled, and the contract the real stores follow (storage/local.js and firebase.js, M6
// and M7): begin(record) once recording starts, append(event) for every event, finish(record).
export function createMemoryStore() {
  const store = {
    record: null,
    events: [],
    media: [],
    finished: false,
    begin(record) { store.record = record; },
    flush() {},
    /** Same shape as the local store's snapshot, so export code does not care which store it has. */
    async snapshot() { return { record: store.record, events: [...store.events] }; },
    append(event) { store.events.push(event); },
    /** Webcam video pieces, kept in memory like the events. */
    async addMedia(piece) { store.media.push({ segment: piece.segment, index: piece.index, blob: piece.blob }); },
    async readMedia() { return [...store.media].sort((a, b) => a.segment - b.segment || a.index - b.index); },
    async nextSegment() { return store.media.reduce((highest, piece) => Math.max(highest, piece.segment), 0) + 1; },
    finish(record) {
      store.record = record;
      store.finished = true;
    },
  };
  return store;
}
