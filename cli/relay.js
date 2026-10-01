// Relay: a small local server that bridges a websocket to a serial port, for setups where
// the browser cannot reach the device directly (phones, Firefox, Safari). The browser
// uses a websocket sink; the relay writes what it receives to the port.
//
//   node cli/relay.js --port COM3 [--baud 115200] [--listen 8765] [--host 127.0.0.1]
//                     [--ack] [--json-value] [--origin https://lab.example.org]
//   node cli/relay.js --list
//
// What is written to the port:
//   binary frame            the bytes, as they are (a websocket sink with format raw)
//   text frame              the UTF-8 text as it is (format ndjson / template)
//   text frame, --json-value  one byte: the integer `value` of an ndjson line
// A {"ping": id, "t": ms} line is answered with {"pong": id, "t": <relay clock ms>} and never
// written to the port (ping sync). With --ack every other message is answered with {"ack": true}
// once it has been written, so the browser can measure the round trip.
// The serial driver is `serialport` (npm install serialport); it is loaded only when needed.
import { fileURLToPath } from 'node:url';
import { listen } from './ws-server.js';

const relayClock = () => performance.timeOrigin + performance.now();

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** The default serial driver: serialport, imported on demand. */
export async function openSerialPort({ path, baudRate }) {
  let module;
  try {
    module = await import('serialport');
  } catch {
    throw new Error('the relay needs the "serialport" package: run  npm install serialport');
  }
  const port = new module.SerialPort({ path, baudRate });
  await new Promise((resolve, reject) => port.once('open', resolve).once('error', reject));
  return {
    write: (bytes) => new Promise((resolve, reject) => port.write(Buffer.from(bytes), (error) => (error ? reject(error) : port.drain(resolve)))),
    close: () => new Promise((resolve) => port.close(() => resolve())),
  };
}

/**
 * @param {{
 *   port?: number, host?: string, serial: {path: string, baud?: number}, openSerial?: Function,
 *   ack?: boolean, jsonValue?: boolean, allowedOrigins?: string[], log?: (line: string) => void,
 * }} options `openSerial({path, baudRate})` returns {write(bytes), close()}; injectable for tests
 */
export async function startRelay({ port = 8765, host = '127.0.0.1', serial, openSerial = openSerialPort, ack = false, jsonValue = false, allowedOrigins, log = () => {} }) {
  const device = await openSerial({ path: serial.path, baudRate: serial.baud ?? 115200 });
  let writes = 0;

  async function toDevice(message, isBinary) {
    if (isBinary) return device.write(message);
    if (jsonValue) {
      const parsed = parseJson(message);
      if (!Number.isInteger(parsed?.value) || parsed.value < 0 || parsed.value > 255) throw new RangeError(`no byte-sized "value" in: ${message.trim()}`);
      return device.write(Uint8Array.of(parsed.value));
    }
    return device.write(Buffer.from(message, 'utf8'));
  }

  const server = await listen({
    port,
    host,
    allowedOrigins,
    onConnection(connection, setHandlers) {
      log('client connected');
      setHandlers({
        async message(message, isBinary) {
          const parsed = isBinary ? null : parseJson(message);
          if (parsed && 'ping' in parsed) {
            connection.sendText(JSON.stringify({ pong: parsed.ping, t: relayClock() }));
            return;
          }
          try {
            await toDevice(message, isBinary);
            writes += 1;
            if (ack) connection.sendText(JSON.stringify({ ack: true, t: relayClock() }));
          } catch (error) {
            log(`not written: ${error.message}`);
          }
        },
        close() { log('client disconnected'); },
      });
    },
  });

  return {
    port: server.port,
    get writes() { return writes; },
    async close() {
      await server.close();
      await device.close();
    },
  };
}

function parseArguments(argv) {
  const options = { baud: 115200, listen: 8765, host: '127.0.0.1', origins: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--port') options.port = argv[++i];
    else if (flag === '--baud') options.baud = Number(argv[++i]);
    else if (flag === '--listen') options.listen = Number(argv[++i]);
    else if (flag === '--host') options.host = argv[++i];
    else if (flag === '--origin') options.origins.push(argv[++i]);
    else if (flag === '--ack') options.ack = true;
    else if (flag === '--json-value') options.jsonValue = true;
    else if (flag === '--list') options.list = true;
    else throw new Error(`unknown option ${flag}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.list) {
    const { SerialPort } = await import('serialport');
    for (const port of await SerialPort.list()) console.log(`${port.path}\t${port.manufacturer ?? ''}\t${port.vendorId ?? ''}:${port.productId ?? ''}`);
    return;
  }
  if (!options.port) throw new Error('usage: node cli/relay.js --port <serial port> [--baud 115200] [--listen 8765] [--ack] [--json-value]');
  const relay = await startRelay({
    port: options.listen,
    host: options.host,
    serial: { path: options.port, baud: options.baud },
    ack: options.ack,
    jsonValue: options.jsonValue,
    allowedOrigins: options.origins.length ? options.origins : undefined,
    log: (line) => console.log(`[relay] ${line}`),
  });
  console.log(`[relay] ws://${options.host}:${relay.port}  ->  ${options.port} @ ${options.baud} baud`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
