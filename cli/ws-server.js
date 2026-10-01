// A minimal WebSocket server (RFC 6455) for the relay, so the CLI needs no dependency.
// It supports what the relay needs: the opening handshake, text / binary messages (with
// fragmentation), ping / pong and close. Frames from browsers are always masked.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE_BYTES = 1024 * 1024;
const OPCODES = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };

export const acceptKey = (key) => createHash('sha1').update(key + GUID).digest('base64');

/** One unmasked server frame. */
export function encodeFrame(opcode, payload) {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([header, body]);
}

/**
 * Parse as many complete frames as the buffer holds.
 * @returns {{frames: {fin: boolean, opcode: number, payload: Buffer}[], rest: Buffer}}
 */
export function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length < cursor + 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length < cursor + 8) break;
      const big = buffer.readBigUInt64BE(cursor);
      if (big > BigInt(MAX_MESSAGE_BYTES)) throw new RangeError('message too big');
      length = Number(big);
      cursor += 8;
    }
    if (length > MAX_MESSAGE_BYTES) throw new RangeError('message too big');
    const maskLength = masked ? 4 : 0;
    if (buffer.length < cursor + maskLength + length) break;
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    const payload = Buffer.from(buffer.subarray(cursor + maskLength, cursor + maskLength + length));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    frames.push({ fin: (first & 0x80) !== 0, opcode: first & 0x0f, payload });
    offset = cursor + maskLength + length;
  }
  return { frames, rest: buffer.subarray(offset) };
}

function connectionFor(socket, handlers) {
  let pending = Buffer.alloc(0);
  let fragments = [];
  let fragmentOpcode = null;
  let open = true;

  const send = (opcode, payload) => { if (open && !socket.destroyed) socket.write(encodeFrame(opcode, payload)); };
  const close = (code = 1000) => {
    if (!open) return;
    send(OPCODES.close, Buffer.from([code >> 8, code & 0xff]));
    open = false;
    socket.end();
  };

  function deliver(opcode, payload) {
    handlers.message?.(opcode === OPCODES.text ? payload.toString('utf8') : payload, opcode === OPCODES.binary);
  }

  function handle(frame) {
    switch (frame.opcode) {
      case OPCODES.ping: send(OPCODES.pong, frame.payload); break;
      case OPCODES.pong: break;
      case OPCODES.close: close(); break;
      case OPCODES.continuation:
        fragments.push(frame.payload);
        if (frame.fin) {
          deliver(fragmentOpcode, Buffer.concat(fragments));
          fragments = [];
          fragmentOpcode = null;
        }
        break;
      default:
        if (frame.fin) {
          deliver(frame.opcode, frame.payload);
        } else {
          fragmentOpcode = frame.opcode;
          fragments = [frame.payload];
        }
    }
  }

  socket.on('data', (chunk) => {
    try {
      const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      frames.forEach(handle);
    } catch {
      close(1009);
    }
  });
  socket.on('close', () => { open = false; handlers.close?.(); });
  socket.on('error', () => socket.destroy());

  return {
    sendText: (text) => send(OPCODES.text, text),
    sendBinary: (bytes) => send(OPCODES.binary, bytes),
    close,
  };
}

/**
 * @param {{port?: number, host?: string, allowedOrigins?: string[], onConnection: (connection: object, handlers: object) => void}} options
 *   `onConnection(connection, setHandlers)`: call `setHandlers({message, close})`.
 * @returns {Promise<{port: number, close: () => Promise<void>}>}
 */
export function listen({ port = 8765, host = '127.0.0.1', allowedOrigins, onConnection }) {
  const server = createServer((_request, response) => {
    response.writeHead(426, { 'content-type': 'text/plain' }).end('This is a WebSocket relay.');
  });
  const sockets = new Set();

  server.on('upgrade', (request, socket) => {
    const key = request.headers['sec-websocket-key'];
    const origin = request.headers.origin;
    const denied = !key || request.headers.upgrade?.toLowerCase() !== 'websocket' || (allowedOrigins && origin && !allowedOrigins.includes(origin));
    if (denied) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const handlers = {};
    const connection = connectionFor(socket, handlers);
    onConnection(connection, (set) => Object.assign(handlers, set));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => {
          for (const socket of sockets) socket.destroy();
          server.close(() => done());
        }),
      });
    });
  });
}
