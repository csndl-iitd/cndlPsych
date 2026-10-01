// A store that keeps the session in memory. It is the storage used when local storage is
// disabled, and the contract the real stores follow (storage/local.js and firebase.js, M6
// and M7): begin(record) once recording starts, append(event) for every event, finish(record).
export function createMemoryStore() {
  const store = {
    record: null,
    events: [],
    finished: false,
    begin(record) { store.record = record; },
    flush() {},
    /** Same shape as the local store's snapshot, so export code does not care which store it has. */
    async snapshot() { return { record: store.record, events: [...store.events] }; },
    append(event) { store.events.push(event); },
    finish(record) {
      store.record = record;
      store.finished = true;
    },
  };
  return store;
}
