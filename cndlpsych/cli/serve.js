// Serve an experiment folder over http://localhost (browsers allow the camera, serial and
// other device APIs on localhost, but not on plain http elsewhere).
//
//   node cli/serve.js [project-dir] [--port 8080]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css; charset=utf-8', '.yaml': 'text/plain; charset=utf-8', '.yml': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2',
  '.wasm': 'application/wasm', '.binarypb': 'application/octet-stream', '.tflite': 'application/octet-stream', '.data': 'application/octet-stream',
};

/**
 * @param {{dir: string, port?: number, rewrite?: (path: string, body: Buffer) => Buffer|string}} options
 *   `rewrite` may change a file's content on its way out (dry-run patches experiment.yaml this way)
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export function serveDirectory({ dir, port = 0, rewrite }) {
  const root = resolve(dir);
  const server = createServer(async (request, response) => {
    let path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
    if (path.includes('..')) {
      response.writeHead(403).end();
      return;
    }
    if (path.endsWith(sep) || path.endsWith('/')) path = join(path, 'index.html');
    try {
      const file = join(root, path);
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      const raw = await readFile(file);
      const body = rewrite ? rewrite(path.split(sep).join('/'), raw) : raw;
      response.writeHead(200, { 'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  return new Promise((resolveListening) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolveListening({ port: actual, url: `http://localhost:${actual}/`, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) });
    });
  });
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { port: { type: 'string', default: '8080' } } });
  const served = await serveDirectory({ dir: positionals[0] ?? '.', port: Number(values.port) });
  console.log(`serving ${resolve(positionals[0] ?? '.')}\nopen ${served.url}   (add ?manage=1 for the stored-data screen)`);
}

if (process.argv[1] === import.meta.filename) main();
