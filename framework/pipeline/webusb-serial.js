// A serial transport over WebUSB, for Android Chrome, which has WebUSB but no Web Serial. It speaks to a
// CDC-ACM device (the class every USB serial adapter and microcontroller with native USB presents) and
// presents the same transport shape as the Web Serial one, so a sink does not know which it has.
// Nothing here knows about a particular device: the interfaces and endpoints come from its descriptor.
const CLASS_COMMUNICATIONS = 0x02;
const CLASS_CDC_DATA = 0x0a;
const SET_LINE_CODING = 0x20;
const SET_CONTROL_LINE_STATE = 0x22;
const DTR_AND_RTS = 0x03;
const READ_BYTES = 4096; // a multiple of every bulk packet size (64, 512)
const STOP_BITS = { 1: 0, 2: 2 };
const PARITY = { none: 0, odd: 1, even: 2 };

const encoder = new TextEncoder();
const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : data);

/** The interface numbers and bulk endpoints to use: the CDC data interface, else any interface with a bulk pair. */
export function findSerialInterfaces(configuration) {
  const alternates = configuration.interfaces.map((iface) => ({ number: iface.interfaceNumber, alternate: iface.alternates[0] })).filter(({ alternate }) => alternate);
  const bulk = (alternate, direction) => alternate.endpoints.find((endpoint) => endpoint.type === 'bulk' && endpoint.direction === direction);
  const hasPair = ({ alternate }) => bulk(alternate, 'in') && bulk(alternate, 'out');
  const data = alternates.find((entry) => entry.alternate.interfaceClass === CLASS_CDC_DATA && hasPair(entry)) ?? alternates.find(hasPair);
  if (!data) return null;
  const control = alternates.find((entry) => entry.alternate.interfaceClass === CLASS_COMMUNICATIONS);
  return {
    data: data.number,
    control: control?.number,
    input: bulk(data.alternate, 'in'),
    output: bulk(data.alternate, 'out'),
  };
}

/**
 * @param {object} config serial sink (baud, data_bits, stop_bits, parity, usb_filters)
 * @param {{usb?: object}} [apis] `usb` is navigator.usb
 */
export function createWebUsbSerialTransport(config, { usb = globalThis.navigator?.usb } = {}) {
  let device = null;
  let found = null;
  let closed = true;
  let messageHandler = null;
  let dataHandler = null;
  let closeHandler = null;

  /** Line coding and the control lines. Devices that do not need them may refuse them: that is not an error. */
  async function configureLine() {
    if (found.control === undefined) return;
    const coding = new DataView(new ArrayBuffer(7));
    coding.setUint32(0, config.baud ?? 115200, true);
    coding.setUint8(4, STOP_BITS[config.stop_bits ?? 1]);
    coding.setUint8(5, PARITY[config.parity ?? 'none']);
    coding.setUint8(6, config.data_bits ?? 8);
    const setup = (request, value) => ({ requestType: 'class', recipient: 'interface', request, value, index: found.control });
    await device.controlTransferOut(setup(SET_LINE_CODING, 0), coding).catch(() => {});
    await device.controlTransferOut(setup(SET_CONTROL_LINE_STATE, DTR_AND_RTS)).catch(() => {});
  }

  async function readLoop() {
    try {
      while (!closed) {
        const result = await device.transferIn(found.input.endpointNumber, READ_BYTES);
        if (closed) return;
        if (result.status === 'stall') await device.clearHalt('in', found.input.endpointNumber);
        if (result.status !== 'ok' || !result.data?.byteLength) continue;
        const bytes = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
        messageHandler?.(bytes);
        dataHandler?.(bytes);
      }
    } catch (error) { // an unplugged device ends the transfer in progress with an error
      if (!closed) closeHandler?.(error.message);
    }
  }

  return {
    kind: 'webusb',
    onMessage(handler) { messageHandler = handler; },
    onData(handler) { dataHandler = handler; },
    onClose(handler) { closeHandler = handler; },

    /** Needs a user gesture (the browser's device picker). */
    async connect() {
      if (!usb) throw new Error('WebUSB is not available in this browser (use Chrome on Android or a computer)');
      const filters = (config.usb_filters ?? []).map((f) => ({ vendorId: f.usb_vendor_id, ...(f.usb_product_id === undefined ? {} : { productId: f.usb_product_id }) }));
      device = await usb.requestDevice({ filters });
      await device.open();
      if (!device.configuration) await device.selectConfiguration(1);
      found = findSerialInterfaces(device.configuration);
      if (!found) {
        await device.close();
        throw new Error('this USB device has no serial (bulk in and out) interface');
      }
      await device.claimInterface(found.data);
      if (found.control !== undefined) await device.claimInterface(found.control).catch(() => { found.control = undefined; });
      await configureLine();
      closed = false;
      if (messageHandler || dataHandler) readLoop();
    },

    async write(data) {
      const result = await device.transferOut(found.output.endpointNumber, toBytes(data));
      if (result.status !== 'ok') throw new Error(`USB transfer failed (${result.status})`);
    },

    async close() {
      closed = true;
      try { await device?.close(); } catch { /* already closed */ }
    },
  };
}
