import { describe, expect, it } from 'vitest';
import { createFakeTime } from '../../tools/fake-time.js';
import { createSerialTransport, createUsbTransport, createWebSocketTransport } from './transports.js';

// ---- Web Serial -----------------------------------------------------------------------
function fakeSerial({ failOpen = false } = {}) {
  const log = { requested: null, opened: null, writes: [], closed: false, reads: [], released: false };
  const incoming = [];
  let wake = null;
  const port = {
    open: async (options) => { if (failOpen) throw new Error('busy'); log.opened = options; },
    writable: { getWriter: () => ({ write: async (data) => { log.writes.push(data); }, releaseLock: () => { log.released = true; } }) },
    readable: {
      getReader: () => ({
        read: () => (incoming.length ? Promise.resolve({ value: incoming.shift(), done: false }) : new Promise((resolve) => { wake = resolve; })),
        cancel: async () => { wake?.({ done: true }); },
      }),
    },
    close: async () => { log.closed = true; },
  };
  return {
    log,
    push(chunk) { if (wake) { const w = wake; wake = null; w({ value: chunk, done: false }); } else incoming.push(chunk); },
    api: { requestPort: async (options) => { log.requested = options; return port; } },
  };
}

describe('serial transport', () => {
  it('reads and hands on every chunk when a data handler is set, without ack', async () => {
    const fake = fakeSerial();
    const transport = createSerialTransport({}, { serial: fake.api });
    const chunks = [];
    transport.onData((chunk) => chunks.push([...chunk]));
    await transport.connect();
    fake.push(Uint8Array.from([1, 2]));
    await Promise.resolve();
    await Promise.resolve();
    expect(chunks).toEqual([[1, 2]]);
  });

  it('opens the chosen port with the configured line settings (defaults 115200 8N1)', async () => {
    const fake = fakeSerial();
    await createSerialTransport({}, { serial: fake.api }).connect();
    expect(fake.log.opened).toEqual({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
    expect(fake.log.requested).toEqual({});

    const custom = fakeSerial();
    await createSerialTransport({ baud: 9600, data_bits: 7, stop_bits: 2, parity: 'even', flow_control: 'hardware', usb_filters: [{ usb_vendor_id: 4660, usb_product_id: 1 }, { usb_vendor_id: 9 }] }, { serial: custom.api }).connect();
    expect(custom.log.opened).toEqual({ baudRate: 9600, dataBits: 7, stopBits: 2, parity: 'even', flowControl: 'hardware' });
    expect(custom.log.requested).toEqual({ filters: [{ usbVendorId: 4660, usbProductId: 1 }, { usbVendorId: 9 }] });
  });

  it('writes bytes as they are and strings as UTF-8', async () => {
    const fake = fakeSerial();
    const transport = createSerialTransport({}, { serial: fake.api });
    await transport.connect();
    await transport.write(Uint8Array.of(1, 2, 255));
    await transport.write('Ǝ\n');
    expect(fake.log.writes.map((w) => [...w])).toEqual([[1, 2, 255], [0xc6, 0x8e, 10]]);
  });

  it('forwards what the device sends when ack is on', async () => {
    const fake = fakeSerial();
    const transport = createSerialTransport({ ack: true }, { serial: fake.api });
    const received = [];
    transport.onMessage((chunk) => received.push([...chunk]));
    await transport.connect();
    fake.push(Uint8Array.of(6));
    await createFakeTime().settle();
    expect(received).toEqual([[6]]);
  });

  it('explains when Web Serial is missing, and passes through open failures', async () => {
    await expect(createSerialTransport({}, { serial: undefined }).connect()).rejects.toThrow(/Web Serial is not available/);
    await expect(createSerialTransport({}, { serial: fakeSerial({ failOpen: true }).api }).connect()).rejects.toThrow('busy');
  });

  it('closes the reader, writer and port', async () => {
    const fake = fakeSerial();
    const transport = createSerialTransport({ ack: true }, { serial: fake.api });
    transport.onMessage(() => {});
    await transport.connect();
    await transport.close();
    expect(fake.log.released).toBe(true);
    expect(fake.log.closed).toBe(true);
  });
});

// ---- WebSocket ------------------------------------------------------------------------
function fakeWebSocketClass() {
  const instances = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      instances.push(this);
    }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    fail() { this.onerror?.(); this.readyState = 3; this.onclose?.(); }
    drop() { this.readyState = 3; this.onclose?.(); }
    receive(data) { this.onmessage?.({ data }); }
  }
  return { FakeWebSocket, instances };
}

describe('websocket transport', () => {
  const config = { url: 'ws://localhost:8765' };

  it('connects, sends strings and bytes, and forwards messages', async () => {
    const time = createFakeTime();
    const { FakeWebSocket, instances } = fakeWebSocketClass();
    const transport = createWebSocketTransport(config, { WebSocketImpl: FakeWebSocket, schedule: time.schedule });
    const received = [];
    transport.onMessage((m) => received.push(m));
    const connecting = transport.connect();
    instances[0].open();
    await connecting;
    await transport.write('hello\n');
    await transport.write(Uint8Array.of(7));
    instances[0].receive('pong');
    expect(instances[0]).toMatchObject({ url: 'ws://localhost:8765', binaryType: 'arraybuffer' });
    expect(instances[0].sent).toEqual(['hello\n', Uint8Array.of(7)]);
    expect(received).toEqual(['pong']);
  });

  it('rejects when the connection fails or times out', async () => {
    const time = createFakeTime();
    const { FakeWebSocket, instances } = fakeWebSocketClass();
    const failing = createWebSocketTransport(config, { WebSocketImpl: FakeWebSocket, schedule: time.schedule });
    const first = failing.connect();
    instances[0].fail();
    await expect(first).rejects.toThrow('could not connect to ws://localhost:8765');

    const slow = createWebSocketTransport(config, { WebSocketImpl: FakeWebSocket, schedule: time.schedule, connectTimeoutMs: 1000 });
    const second = slow.connect();
    const assertion = expect(second).rejects.toThrow('timed out');
    await time.advance(1000);
    await assertion;
  });

  it('refuses to write when the socket is not open', async () => {
    const { FakeWebSocket } = fakeWebSocketClass();
    const transport = createWebSocketTransport(config, { WebSocketImpl: FakeWebSocket, schedule: createFakeTime().schedule });
    await expect(transport.write('x')).rejects.toThrow('not open');
  });

  it('reconnects with doubling delays capped at max_delay_ms, and reports close and open', async () => {
    const time = createFakeTime();
    const { FakeWebSocket, instances } = fakeWebSocketClass();
    const transport = createWebSocketTransport({ ...config, reconnect: { max_delay_ms: 400 } }, { WebSocketImpl: FakeWebSocket, schedule: time.schedule });
    const events = [];
    transport.onClose((detail) => events.push(['close', detail]));
    transport.onOpen(() => events.push(['open']));
    const connecting = transport.connect();
    instances[0].open();
    await connecting;

    instances[0].drop();
    expect(events).toEqual([['close', 'connection closed']]);
    await time.advance(99);
    expect(instances).toHaveLength(1);
    await time.advance(1);
    expect(instances).toHaveLength(2);
    instances[1].fail();
    await time.advance(200);
    expect(instances).toHaveLength(3);
    instances[2].fail();
    await time.advance(399);
    expect(instances).toHaveLength(3);
    await time.advance(1);
    expect(instances).toHaveLength(4);
    instances[3].fail();
    await time.advance(400);
    expect(instances).toHaveLength(5);
    instances[4].open();
    await time.settle();
    expect(events.at(-1)).toEqual(['open']);
    await transport.write('x');
    expect(instances[4].sent).toEqual(['x']);
  });

  it('does not reconnect when disabled or after close()', async () => {
    const time = createFakeTime();
    const { FakeWebSocket, instances } = fakeWebSocketClass();
    const off = createWebSocketTransport({ ...config, reconnect: { enabled: false } }, { WebSocketImpl: FakeWebSocket, schedule: time.schedule });
    const connecting = off.connect();
    instances[0].open();
    await connecting;
    instances[0].drop();
    await time.advance(10_000);
    expect(instances).toHaveLength(1);

    const closing = createWebSocketTransport(config, { WebSocketImpl: FakeWebSocket, schedule: time.schedule });
    const second = closing.connect();
    instances[1].open();
    await second;
    await closing.close();
    await time.advance(10_000);
    expect(instances).toHaveLength(2);
  });
});

// ---- WebUSB -------------------------------------------------------------------------
describe('usb transport', () => {
  function fakeUsb({ status = 'ok' } = {}) {
    const log = { filters: null, calls: [], transfers: [] };
    const device = {
      open: async () => log.calls.push('open'),
      selectConfiguration: async (n) => log.calls.push(`config ${n}`),
      claimInterface: async (n) => log.calls.push(`interface ${n}`),
      transferOut: async (endpoint, data) => { log.transfers.push([endpoint, [...data]]); return { status }; },
      close: async () => log.calls.push('close'),
    };
    return { log, api: { requestDevice: async ({ filters }) => { log.filters = filters; return device; } } };
  }

  it('picks the device, selects the configuration, claims the interface and writes to the endpoint', async () => {
    const fake = fakeUsb();
    const transport = createUsbTransport({ vendor_id: 4660, product_id: 22136, configuration: 2, interface: 1, endpoint: 3 }, { usb: fake.api });
    await transport.connect();
    await transport.write(Uint8Array.of(5));
    await transport.write('A');
    await transport.close();
    expect(fake.log.filters).toEqual([{ vendorId: 4660, productId: 22136 }]);
    expect(fake.log.calls).toEqual(['open', 'config 2', 'interface 1', 'close']);
    expect(fake.log.transfers).toEqual([[3, [5]], [3, [65]]]);
  });

  it('defaults to configuration 1, interface 0; reports a failed transfer', async () => {
    const fake = fakeUsb({ status: 'stall' });
    const transport = createUsbTransport({ vendor_id: 1, product_id: 2, endpoint: 1 }, { usb: fake.api });
    await transport.connect();
    expect(fake.log.calls).toEqual(['open', 'config 1', 'interface 0']);
    await expect(transport.write(Uint8Array.of(1))).rejects.toThrow('stall');
  });

  it('explains when WebUSB is missing', async () => {
    await expect(createUsbTransport({ vendor_id: 1, product_id: 2, endpoint: 1 }, { usb: undefined }).connect()).rejects.toThrow(/WebUSB is not available/);
  });
});
