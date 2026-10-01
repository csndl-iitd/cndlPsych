// Rebuild the browser test bundles before every Playwright run, so a server that is
// already running can never serve stale code.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export default function globalSetup() {
  execFileSync(process.execPath, [join(import.meta.dirname, '..', 'build-e2e.js')], { stdio: 'inherit' });
}
