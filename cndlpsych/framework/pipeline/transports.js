// Transports: the part of a sink that talks to the outside world. Each takes the browser
// API as an argument (navigator.serial, WebSocket, navigator.usb) so it is tested with
// fakes. Nothing here knows about triggers or formats.
import { schedule as defaultSchedule } from '../foundation/clock.js';

const encoder = new TextEncoder();
const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : data);

// Web Serial keeps 255 bytes unread by default; a device that streams (a photodiode at 1 kHz) overruns that in a few
// milliseconds of a busy page.
const READ_BUFFER_BYTES = 1 << 20;
const MAX_READ_ERRORS = 50;

// ---- Web Serial (desktop Chromium) -----------------------------------------------------
/**
 * @param {object} config serial sink (baud, data_bits, stop_bits, parity, flow_control, usb_filters)
 * @param {{serial?: object}} [apis] `serial` is navigator.serial
 */
export function createSerialTransport(config, { serial = globalThis.navigator?.serial } = {}) {
  let port = null;
  let writer = null;
  let reader = null;
  let messageHandler = null;
  let dataHandler = null;
  let closeHandler = null;
  let closing = false;
  let loop = null;

  /** Read until the port ends. A recoverable error (a buffer overrun, a framing error) leaves the port readable: read on. */
  async function readLoop() {
    let errors = 0;
    let lastError = null;
    while (port.readable && !closing && errors < MAX_READ_ERRORS) {
      reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          lastError = null;
          if (done) { errors = MAX_READ_ERRORS; break; }
          errors = 0;
          messageHandler?.(value);
          dataHandler?.(value);
        }
      } catch (error) {
        errors += 1;
        lastError = error;
      } finally {
        reader.releaseLock();
      }
    }
    if (!closing) closeHandler?.(lastError?.message ?? 'the port was closed');
  }

  return {
    kind: 'serial',
    onMessage(handler) { messageHandler = handler; },
    /** Every chunk of bytes that arrives, as it arrives (the sink's raw capture). */
    onData(handler) { dataHandler = handler; },
    onClose(handler) { closeHandler = handler; },

    /** Needs a user gesture (the browser's port picker). */
    async connect() {
      if (!serial) throw new Error('Web Serial is not available in this browser (use Chrome or Edge on a computer, Chrome on Android, or a websocket sink with the relay)');
      const filters = (config.usb_filters ?? []).map((f) => ({ usbVendorId: f.usb_vendor_id, ...(f.usb_product_id === undefined ? {} : { usbProductId: f.usb_product_id }) }));
      port = await serial.requestPort(filters.length ? { filters } : {});
      await port.open({
        baudRate: config.baud ?? 115200,
        dataBits: config.data_bits ?? 8,
        stopBits: config.stop_bits ?? 1,
        parity: config.parity ?? 'none',
        flowControl: config.flow_control ?? 'none',
        ...(dataHandler ? { bufferSize: READ_BUFFER_BYTES } : {}),
      });
      writer = port.writable.getWriter();
      if ((config.ack && messageHandler) || dataHandler) loop = readLoop();
    },

    async write(data) {
      await writer.write(toBytes(data));
    },

    async close() {
      closing = true;
      try { await reader?.cancel(); } catch { /* already closed */ }
      await loop; // the reader's lock is released, so the port can close
      try { writer?.releaseLock(); } catch { /* already released */ }
      try { await port?.close(); } catch { /* already closed */ }
    },
  };
}

// ---- WebSocket (any browser; the relay bridges to hardware) ---------------------------------
/**
 * @param {object} config websocket sink (url, reconnect: {enabled, max_delay_ms})
 * @param {{WebSocketImpl?: Function, schedule?: Function, connectTimeoutMs?: number}} [options]
 */
export function createWebSocketTransport(config, { WebSocketImpl = globalThis.WebSocket, schedule = defaultSchedule, connectTimeoutMs = 5000 } = {}) {
  let socket = null;
  let closedByUs = false;
  let attempt = 0;
  let cancelRetry = null;
  const handlers = { message: null, close: null, open: null };
  const reconnect = config.reconnect?.enabled !== false;
  const maxDelay = config.reconnect?.max_delay_ms ?? 5000;

  function open() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocketImpl(config.url);
      ws.binaryType = 'arraybuffer';
      const fail = (message) => {
        if (settled) return;
        settled = true;
        cancelTimeout();
        reject(new Error(message));
      };
      const cancelTimeout = schedule(connectTimeoutMs, () => { fail(`timed out connecting to ${config.url}`); ws.close(); });
      ws.onopen = () => {
        if (settled) return;
        settled = true;
        cancelTimeout();
        socket = ws;
        resolve();
      };
      ws.onerror = () => fail(`could not connect to ${config.url}`);
      ws.onmessage = (event) => handlers.message?.(event.data);
      ws.onclose = () => {
        if (!settled) { fail(`connection to ${config.url} closed`); return; }
        if (socket !== ws) return;
        socket = null;
        if (closedByUs) return;
        handlers.close?.('connection closed');
        if (reconnect) scheduleRetry();
      };
    });
  }

  function scheduleRetry() {
    const delay = Math.min(maxDelay, 100 * 2 ** attempt);
    attempt += 1;
    cancelRetry = schedule(delay, () => {
      open().then(() => { attempt = 0; handlers.open?.(); }, () => scheduleRetry());
    });
  }

  return {
    onMessage(handler) { handlers.message = handler; },
    onClose(handler) { handlers.close = handler; },
    onOpen(handler) { handlers.open = handler; },
    connect: open,

    async write(data) {
      if (!socket || socket.readyState !== 1) throw new Error('websocket is not open');
      socket.send(data);
    },

    async close() {
      closedByUs = true;
      cancelRetry?.();
      socket?.close();
      socket = null;
    },
  };
}

// ---- WebUSB (Android Chrome and desktop Chromium) ---------------------------------------------
/**
 * @param {object} config usb sink (vendor_id, product_id, configuration, interface, endpoint)
 * @param {{usb?: object}} [apis] `usb` is navigator.usb
 */
export function createUsbTransport(config, { usb = globalThis.navigator?.usb } = {}) {
  let device = null;

  return {
    /** Needs a user gesture (the browser's device picker). */
    async connect() {
      if (!usb) throw new Error('WebUSB is not available in this browser (use Chrome on Android or desktop)');
      device = await usb.requestDevice({ filters: [{ vendorId: config.vendor_id, productId: config.product_id }] });
      await device.open();
      await device.selectConfiguration(config.configuration ?? 1);
      await device.claimInterface(config.interface ?? 0);
    },

    async write(data) {
      const result = await device.transferOut(config.endpoint, toBytes(data));
      if (result.status !== 'ok') throw new Error(`USB transfer failed (${result.status})`);
    },

    async close() {
      try { await device?.close(); } catch { /* already closed */ }
    },
  };
}
