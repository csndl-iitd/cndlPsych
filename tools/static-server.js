// Minimal static file server for browser tests: serves the repo root.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.yaml': 'text/plain' };

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (path === sep || path === '/') {
    response.writeHead(302, { location: '/tools/e2e/play.html' }).end();
    return;
  }
  if (path.includes('..')) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(join(ROOT, path));
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`serving ${ROOT}
open http://localhost:${PORT}/  (the play page; add ?scale=0.2 for a fast run)`));
