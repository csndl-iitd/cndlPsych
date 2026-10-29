// Builds the session's trigger sinks from experiment.yaml and keeps their status events.
// Sinks connect before recording starts (a required sink that cannot connect blocks the
// session, leaving no trace), so status events raised until then are kept and replayed
// once recording begins.
import { schedule as defaultSchedule } from '../foundation/clock.js';
import { isMobileSystem } from '../foundation/device.js';
import { createCapture } from '../pipeline/capture.js';
import { createSink } from '../pipeline/sink.js';
import { createSerialTransport, createUsbTransport, createWebSocketTransport } from '../pipeline/transports.js';
import { createWebUsbSerialTransport } from '../pipeline/webusb-serial.js';

/** Sink types whose browser API needs a user gesture (a port / device picker). */
export const NEEDS_GESTURE = new Set(['serial', 'usb']);

/**
 * @param {{plan: object, bus: object, clock: object, schedule?: Function, apis?: object, onRequiredLost?: (id: string) => void}} options
 *   `apis` overrides {serial, usb, WebSocket} (the browser's by default)
 */
export function createSinks({ plan, bus, clock, schedule = defaultSchedule, apis = {}, onRequiredLost }) {
  const backlog = [];
  const sinks = new Map();
  const skipped = new Set(); // sinks the experimenter went on without, or that are not used on this device
  const configs = plan.triggers?.sinks ?? [];
  const capture = createCapture({ schedule, onError: (error) => emit({ source: 'system', type: 'system.warning', data: { code: 'capture_failed', message: `the raw device data could not be kept: ${error?.message ?? error}` } }) });

  const emit = (event) => {
    if (bus.recording) bus.emit(event);
    else backlog.push({ ...event, t: clock.now() });
  };

  const transportFor = (config) => {
    const browser = globalThis.navigator ?? {};
    if (config.type === 'serial') {
      // Android has WebUSB but no Web Serial: the same sink talks to the serial device over USB there.
      const usb = apis.usb ?? browser.usb;
      if (usb && isMobileSystem(browser)) return createWebUsbSerialTransport(config, { usb });
      return createSerialTransport(config, { serial: apis.serial ?? browser.serial });
    }
    if (config.type === 'usb') return createUsbTransport(config, { usb: apis.usb ?? browser.usb });
    return createWebSocketTransport(config, { WebSocketImpl: apis.WebSocket ?? globalThis.WebSocket, schedule });
  };

  for (const config of configs) {
    let sink;
    sink = createSink(config, transportFor(config), {
      clock,
      schedule,
      defaults: plan.triggers?.defaults,
      report: {
        status(state, detail) {
          emit({ source: 'trigger', type: 'sink.status', data: { sink: config.id, state, ...(detail ? { detail } : {}) } });
          if (bus.recording && sink.required && (state === 'disconnected' || state === 'error')) onRequiredLost?.(config.id);
        },
        sync(sample) {
          emit({ source: 'trigger', type: 'sink.sync', data: { sink: config.id, ...sample } });
        },
        capture: (chunk) => capture.add({ sink: config.id, ...chunk }),
      },
    });
    sinks.set(config.id, sink);
  }

  return {
    sinks,
    configs,
    /** The `sinks.trigger` block of the session record. */
    record: () => configs.map((config) => ({
      id: config.id, type: config.type, format: config.format, required: config.required !== false, connected: sinks.get(config.id)?.connected ?? false,
      ...(sinks.get(config.id)?.transport ? { transport: sinks.get(config.id).transport } : {}),
      ...(config.capture?.raw && capture.totals(config.id) ? { capture: capture.totals(config.id) } : {}),
      ...(skipped.has(config.id) ? { skipped: true } : {}),
    })),
    /** Go on without this sink: it is closed and takes no more triggers (rules that name it simply have nowhere to send). */
    async skip(id) {
      await sinks.get(id)?.close?.();
      sinks.delete(id);
      skipped.add(id);
    },
    /** Keep the raw device data in this session's store (what arrived before is written now). */
    attachStore: (store) => capture.attach(store),
    flushCapture: () => capture.flush(),
    /** Emit what was reported before recording started (call right after startRecording). */
    flushBacklog() {
      for (const event of backlog.splice(0)) bus.emit(event);
    },
    /** Wait until every sink has written what it has queued (bounded, so a stuck port cannot hold the session). */
    async drain(timeoutMs = 2000) {
      let cancel = () => {};
      const timeout = new Promise((resolve) => { cancel = schedule(timeoutMs, resolve); });
      await Promise.race([Promise.all([...sinks.values()].map((sink) => sink.drain())), timeout]);
      cancel();
      await capture.flush();
    },
    async closeAll() {
      await Promise.all([...sinks.values()].map((sink) => sink.close().catch(() => {})));
      await capture.flush();
    },
  };
}
