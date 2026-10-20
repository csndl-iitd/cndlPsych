// Listen: a local websocket server that receives triggers and shows them, to check what an experiment
// sends before a real device is connected (or to log them next to a recording). The browser uses a
// websocket sink pointing here; nothing is written to any device.
//
//   node cli/listen.js [--listen 8765] [--host 127.0.0.1] [--ack] [--csv triggers.csv] [--origin https://lab.example.org]
//
// What is understood:
//   text frame with JSON (a websocket sink with format ndjson): one trigger, its fields shown
//   text frame, anything else (format template): shown as text
//   binary frame (format raw): the bytes, shown as hex, the first byte as the value
// A {"ping": id, "t": ms} line is answered with {"pong": id, "t": <this clock, ms>} (ping sync). With --ack every
// other message is answered with {"ack": true}, so the browser can measure the round trip.
// On Ctrl+C a count per value is printed.
import { appendFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listen } from './ws-server.js';

const clock = () => performance.timeOrigin + performance.now();
const KNOWN = ['value', 'event', 'rule', 'seq', 't_event', 't_sent'];
const CSV_COLUMNS = ['received_at', 'received_ms', 'value', 'event', 'rule', 'seq', 't_event', 't_sent', 'other'];

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

const csvCell = (value) => {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** One received message as a record: `value` when there is one, the fields the sink sent, and the raw text or bytes. */
export function describeMessage(message, isBinary) {
  if (isBinary) {
    const bytes = [...message];
    return { value: bytes[0], hex: bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ') };
  }
  const parsed = parseJson(message);
  if (parsed && typeof parsed === 'object') return parsed;
  return { text: message.trimEnd() };
}

/** The line shown for a record. */
export function formatRecord(record, receivedMs) {
  const time = new Date(receivedMs).toISOString().slice(11, 23);
  const rest = Object.entries(record).filter(([key]) => !KNOWN.includes(key));
  const known = [record.event, record.rule && `rule=${record.rule}`, record.seq !== undefined && `seq=${record.seq}`, record.t_event !== undefined && `t_event=${record.t_event}`, record.t_sent !== undefined && `t_sent=${record.t_sent}`].filter(Boolean);
  const value = record.value === undefined ? '  -' : String(record.value).padStart(3);
  return `${time}  ${value}  ${[...known, ...rest.map(([key, v]) => `${key}=${typeof v === 'object' ? JSON.stringify(v) : v}`)].join('  ')}`;
}

/**
 * @param {{port?: number, host?: string, ack?: boolean, allowedOrigins?: string[], csv?: string, onTrigger?: (record: object, receivedMs: number) => void, log?: (line: string) => void}} options
 * @returns {Promise<{port: number, counts: Map<number|string, number>, close: () => Promise<void>}>}
 */
export async function startListener({ port = 8765, host = '127.0.0.1', ack = false, allowedOrigins, csv, onTrigger = () => {}, log = () => {} }) {
  const counts = new Map();
  if (csv) writeFileSync(csv, `${CSV_COLUMNS.join(',')}\r\n`);

  function record(parsed, receivedMs) {
    counts.set(parsed.value ?? '-', (counts.get(parsed.value ?? '-') ?? 0) + 1);
    onTrigger(parsed, receivedMs);
    if (csv) {
      const other = Object.fromEntries(Object.entries(parsed).filter(([key]) => !KNOWN.includes(key)));
      const row = [new Date(receivedMs).toISOString(), receivedMs, parsed.value, parsed.event, parsed.rule, parsed.seq, parsed.t_event, parsed.t_sent, Object.keys(other).length ? other : undefined];
      appendFileSync(csv, `${row.map(csvCell).join(',')}\r\n`);
    }
  }

  const server = await listen({
    port,
    host,
    allowedOrigins,
    onConnection(connection, setHandlers) {
      log('client connected');
      setHandlers({
        message(message, isBinary) {
          const receivedMs = clock();
          const parsed = describeMessage(message, isBinary);
          if ('ping' in parsed) {
            connection.sendText(JSON.stringify({ pong: parsed.ping, t: clock() }));
            return;
          }
          record(parsed, receivedMs);
          log(formatRecord(parsed, receivedMs));
          if (ack) connection.sendText(JSON.stringify({ ack: true, t: clock() }));
        },
        close() { log('client disconnected'); },
      });
    },
  });
  return { port: server.port, counts, close: () => server.close() };
}

function parseArguments(argv) {
  const options = { listen: 8765, host: '127.0.0.1', origins: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--listen') options.listen = Number(argv[++i]);
    else if (flag === '--host') options.host = argv[++i];
    else if (flag === '--origin') options.origins.push(argv[++i]);
    else if (flag === '--csv') options.csv = argv[++i];
    else if (flag === '--ack') options.ack = true;
    else throw new Error(`unknown option ${flag}`);
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const listener = await startListener({
    port: options.listen,
    host: options.host,
    ack: options.ack,
    csv: options.csv,
    allowedOrigins: options.origins.length ? options.origins : undefined,
    log: (line) => console.log(line),
  });
  console.log(`listening on ws://${options.host}:${listener.port}${options.csv ? `, writing ${options.csv}` : ''}${options.ack ? ', answering each trigger' : ''}  (Ctrl+C to stop)`);
  process.on('SIGINT', async () => {
    const total = [...listener.counts.values()].reduce((sum, n) => sum + n, 0);
    console.log(`\n${total} trigger(s) received${total ? ':' : ''}`);
    for (const [value, count] of [...listener.counts].sort((a, b) => Number(a[0]) - Number(b[0]))) console.log(`  ${String(value).padStart(3)}  x ${count}`);
    await listener.close();
    process.exit(0);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
