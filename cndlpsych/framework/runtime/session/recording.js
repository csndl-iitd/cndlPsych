// Starting to record: connecting the store to the bus, and the first notices in the log.

/** Wire the store to the bus; call just before recording starts. */
export function connectStore({ services, store }) {
  services.bus.on('*', (event) => store.append(event));
  services.sinkSet.attachStore(store);
  services.input.onLeave(() => { store.flush(); services.sinkSet.flushCapture(); });
}

/** 'closed' is not logged: it would come after the last event the record counts. A status names its sink; the local store's does not. */
export function logStorageStatus({ bus, store }) {
  store.onStatus?.((status) => status.state !== 'closed' && bus.emit({ source: 'storage', type: 'storage.status', data: { sink: 'local', ...status } }));
}

/** Warnings that belong at the start of the log: scaled time, and optional sinks that did not connect. */
export function emitStartNotices({ bus, debug, sinkSet, sinkWarnings }) {
  if (debug.time_scale !== undefined && debug.time_scale !== 1) {
    bus.emit({ source: 'system', type: 'system.warning', data: { code: 'debug_time_scale', message: `durations are scaled by ${debug.time_scale}; this is not valid data` } });
  }
  sinkSet.flushBacklog();
  for (const { id, error } of sinkWarnings) {
    bus.emit({ source: 'system', type: 'system.warning', data: { code: 'sink_unavailable', message: `optional trigger sink "${id}" is not available: ${error}`, detail: { sink: id } } });
  }
}
