import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { acceptKey, decodeFrames, encodeFrame, listen } from './ws-server.js';

const servers = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((s) => s.close())); });

async function start(options = {}) {
  const received = [];
  const connections = [];
  const server = await listen({
    port: 0,
    ...options,
    onConnection(connection, setHandlers) {
      connections.push(connection);
      setHandlers({ message: (message, isBinary) => received.push([message, isBinary]), close() {} });
    },
  });
  servers.push(server);
  return { server, received, connections, url: `ws://127.0.0.1:${server.port}` };
}

const open = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => resolve(ws);
  ws.onerror = () => reject(new Error('connection failed'));
});

const until = async (check, timeout = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** A masked client frame, as browsers send them. */
function clientFrame(opcode, payload, { fin = true } = {}) {
  const body = Buffer.from(payload);
  const mask = Buffer.from([1, 2, 3, 4]);
  const header = body.length < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | body.length]) : Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126]), Buffer.from([body.length >> 8, body.length & 0xff])]);
  return Buffer.concat([header, mask, Buffer.from(body.map((b, i) => b ^ mask[i % 4]))]);
}

describe('frames', () => {
  it('encodes small, medium and large payloads with the right length fields', () => {
    expect([...encodeFrame(1, 'hi')]).toEqual([0x81, 2, 104, 105]);
    const medium = encodeFrame(2, Buffer.alloc(200));
    expect([medium[0], medium[1], medium.readUInt16BE(2), medium.length]).toEqual([0x82, 126, 200, 204]);
    const large = encodeFrame(2, Buffer.alloc(70_000));
    expect([large[1], Number(large.readBigUInt64BE(2)), large.length]).toEqual([127, 70_000, 70_010]);
  });

  it('decodes masked client frames, several in one buffer, and keeps incomplete data', () => {
    const buffer = Buffer.concat([clientFrame(1, 'hello'), clientFrame(2, [1, 2, 3]), clientFrame(1, 'cut').subarray(0, 4)]);
    const { frames, rest } = decodeFrames(buffer);
    expect(frames.map((f) => [f.opcode, f.fin, f.payload.toString('latin1')])).toEqual([[1, true, 'hello'], [2, true, '\u0001\u0002\u0003']]);
    expect(rest.length).toBe(4);
  });

  it('round trips unmasked payloads through the decoder', () => {
    for (const size of [0, 5, 125, 126, 65_535, 65_536, 100_000]) {
      const payload = Buffer.alloc(size, 7);
      const { frames } = decodeFrames(encodeFrame(2, payload));
      expect(frames[0].payload.equals(payload)).toBe(true);
    }
  });

  it('rejects messages over the size limit', () => {
    expect(() => decodeFrames(encodeFrame(2, Buffer.alloc(1024 * 1024 + 1)))).toThrow(/too big/);
  });

  it('computes the RFC 6455 accept key', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

describe('server', () => {
  it('receives text and binary messages and sends both back', async () => {
    const { received, connections, url } = await start();
    const ws = await open(url);
    const incoming = [];
    ws.onmessage = (event) => incoming.push(event.data);
    ws.send('hello Ǝ');
    ws.send(Uint8Array.of(1, 255));
    await until(() => received.length === 2);
    expect(received[0]).toEqual(['hello Ǝ', false]);
    expect([...received[1][0]]).toEqual([1, 255]);
    expect(received[1][1]).toBe(true);

    connections[0].sendText('pong');
    connections[0].sendBinary(Uint8Array.of(9));
    await until(() => incoming.length === 2);
    expect(incoming[0]).toBe('pong');
    expect([...new Uint8Array(incoming[1])]).toEqual([9]);
    ws.close();
  });

  it('handles large messages (64-bit length)', async () => {
    const { received, url } = await start();
    const ws = await open(url);
    ws.send('x'.repeat(100_000));
    await until(() => received.length === 1);
    expect(received[0][0]).toHaveLength(100_000);
    ws.close();
  });

  it('reassembles fragmented messages and answers pings', async () => {
    const { received, url } = await start();
    const socket = net.connect(new URL(url).port, '127.0.0.1');
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
    await until(() => Buffer.concat(chunks).toString().includes('101 Switching'));
    expect(Buffer.concat(chunks).toString()).toContain('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    socket.write(Buffer.concat([clientFrame(1, 'frag', { fin: false }), clientFrame(0, 'ment', { fin: true })]));
    await until(() => received.length === 1);
    expect(received[0]).toEqual(['fragment', false]);

    chunks.length = 0;
    socket.write(clientFrame(9, 'p'));
    await until(() => chunks.length > 0);
    expect([...Buffer.concat(chunks)]).toEqual([0x8a, 1, 112]);
    socket.destroy();
  });

  it('refuses a browser from an origin that is not allowed, and plain HTTP', async () => {
    const { server, url } = await start({ allowedOrigins: ['https://lab.example.org'] });
    const denied = await new Promise((resolve) => {
      const socket = net.connect(server.port, '127.0.0.1');
      let text = '';
      socket.on('data', (c) => { text += c; });
      socket.on('close', () => resolve(text));
      socket.write('GET / HTTP/1.1\r\nHost: x\r\nOrigin: https://evil.example\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: abc\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    expect(denied).toContain('403');
    const plain = await fetch(url.replace('ws:', 'http:'));
    expect(plain.status).toBe(426);
  });

  it('closes cleanly when the client closes', async () => {
    const { url } = await start();
    const ws = await open(url);
    const closed = new Promise((resolve) => { ws.onclose = resolve; });
    ws.close();
    await closed;
  });
});
