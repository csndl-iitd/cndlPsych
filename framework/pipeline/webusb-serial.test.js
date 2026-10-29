import { describe, expect, it } from 'vitest';
import { createWebUsbSerialTransport, findSerialInterfaces } from './webusb-serial.js';

const endpoint = (endpointNumber, direction, type = 'bulk') => ({ endpointNumber, direction, type });
const iface = (interfaceNumber, interfaceClass, endpoints = []) => ({ interfaceNumber, alternates: [{ interfaceClass, endpoints }] });
const CDC = { interfaces: [iface(0, 0x02, [endpoint(3, 'in', 'interrupt')]), iface(1, 0x0a, [endpoint(1, 'out'), endpoint(2, 'in')])] };

function fakeUsb({ configuration = CDC, transferOutStatus = 'ok' } = {}) {
  const log = { requested: null, opened: false, selected: null, claimed: [], control: [], out: [], closed: false };
  const waiting = [];
  const device = {
    configuration: null,
    open: async () => { log.opened = true; },
    selectConfiguration: async (n) => { log.selected = n; device.configuration = configuration; },
    claimInterface: async (n) => { log.claimed.push(n); },
    controlTransferOut: async (setup, data) => { log.control.push({ setup, data: data && [...new Uint8Array(data.buffer)] }); return { status: 'ok' }; },
    transferIn: () => new Promise((resolve) => { waiting.push(resolve); }),
    transferOut: async (ep, data) => { log.out.push({ ep, data: [...data] }); return { status: transferOutStatus }; },
    clearHalt: async () => {},
    close: async () => { log.closed = true; },
  };
  const result = (status, bytes) => ({ status, data: bytes && new DataView(new Uint8Array(bytes).buffer) });
  return {
    log,
    device,
    api: { requestDevice: async (options) => { log.requested = options; return device; } },
    push: async (bytes, status = 'ok') => { waiting.shift()(result(status, bytes)); await Promise.resolve(); await Promise.resolve(); },
    fail: async (error) => { waiting.shift()(Promise.reject(error)); await Promise.resolve(); await Promise.resolve(); },
  };
}

describe('findSerialInterfaces', () => {
  it('takes the CDC data interface and its bulk endpoints, and the communications interface for the control lines', () => {
    expect(findSerialInterfaces(CDC)).toMatchObject({ data: 1, control: 0, input: { endpointNumber: 2 }, output: { endpointNumber: 1 } });
  });

  it('falls back to any interface with a bulk pair, and says there is none', () => {
    const vendor = { interfaces: [iface(0, 0xff, [endpoint(5, 'out'), endpoint(6, 'in')])] };
    expect(findSerialInterfaces(vendor)).toMatchObject({ data: 0, control: undefined, input: { endpointNumber: 6 } });
    expect(findSerialInterfaces({ interfaces: [iface(0, 0x03, [endpoint(1, 'in', 'interrupt')])] })).toBeNull();
  });
});

describe('the WebUSB serial transport', () => {
  it('asks the browser for the device with the filters (or every device), opens it, claims the interfaces and sets the line', async () => {
    const fake = fakeUsb();
    await createWebUsbSerialTransport({ baud: 9600, parity: 'even', stop_bits: 2, data_bits: 7, usb_filters: [{ usb_vendor_id: 4660, usb_product_id: 1 }, { usb_vendor_id: 9 }] }, { usb: fake.api }).connect();
    expect(fake.log.requested).toEqual({ filters: [{ vendorId: 4660, productId: 1 }, { vendorId: 9 }] });
    expect(fake.log.selected).toBe(1);
    expect(fake.log.claimed).toEqual([1, 0]);
    expect(fake.log.control[0]).toMatchObject({ setup: { requestType: 'class', recipient: 'interface', request: 0x20, index: 0 }, data: [0x80, 0x25, 0, 0, 2, 2, 7] }); // 9600 baud, 2 stop bits, even parity, 7 data bits
    expect(fake.log.control[1].setup).toMatchObject({ request: 0x22, value: 3, index: 0 }); // DTR and RTS

    const any = fakeUsb();
    await createWebUsbSerialTransport({}, { usb: any.api }).connect();
    expect(any.log.requested).toEqual({ filters: [] });
  });

  it('hands every chunk of received bytes on as it arrives, to onData and onMessage', async () => {
    const fake = fakeUsb();
    const transport = createWebUsbSerialTransport({}, { usb: fake.api });
    const data = [];
    const messages = [];
    transport.onData((bytes) => data.push([...bytes]));
    transport.onMessage((bytes) => messages.push([...bytes]));
    await transport.connect();
    await fake.push([0x31, 0x41, 0x0a]);
    await fake.push([], 'ok'); // an empty read is not a chunk
    await fake.push([0x54, 0x2c]);
    expect(data).toEqual([[0x31, 0x41, 0x0a], [0x54, 0x2c]]);
    expect(messages).toEqual(data);
  });

  it('writes the bytes to the OUT endpoint, and fails the write when the transfer is not ok', async () => {
    const fake = fakeUsb();
    const transport = createWebUsbSerialTransport({}, { usb: fake.api });
    await transport.connect();
    await transport.write(new Uint8Array([7]));
    await transport.write('ab');
    expect(fake.log.out).toEqual([{ ep: 1, data: [7] }, { ep: 1, data: [0x61, 0x62] }]);
    const stalled = fakeUsb({ transferOutStatus: 'stall' });
    const bad = createWebUsbSerialTransport({}, { usb: stalled.api });
    await bad.connect();
    await expect(bad.write(new Uint8Array([1]))).rejects.toThrow('USB transfer failed (stall)');
  });

  it('reports an unplugged device (a failed read) once, and nothing after close', async () => {
    const fake = fakeUsb();
    const transport = createWebUsbSerialTransport({}, { usb: fake.api });
    const closes = [];
    transport.onData(() => {});
    transport.onClose((detail) => closes.push(detail));
    await transport.connect();
    await fake.fail(new Error('The device was disconnected.'));
    expect(closes).toEqual(['The device was disconnected.']);

    const quiet = fakeUsb();
    const other = createWebUsbSerialTransport({}, { usb: quiet.api });
    const more = [];
    other.onData(() => {});
    other.onClose((detail) => more.push(detail));
    await other.connect();
    await other.close();
    expect(quiet.log.closed).toBe(true);
    await quiet.fail(new Error('after close'));
    expect(more).toEqual([]);
  });

  it('says why when WebUSB is missing or the device is not a serial device', async () => {
    await expect(createWebUsbSerialTransport({}, { usb: undefined }).connect()).rejects.toThrow('WebUSB is not available');
    const hid = fakeUsb({ configuration: { interfaces: [iface(0, 0x03, [endpoint(1, 'in', 'interrupt')])] } });
    await expect(createWebUsbSerialTransport({}, { usb: hid.api }).connect()).rejects.toThrow('no serial');
    expect(hid.log.closed).toBe(true);
  });
});
