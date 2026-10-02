// A real browser kill: launch Chromium with a persistent profile, and later SIGKILL every
// process that uses that profile. Nothing gets to run: no unload handlers, no flush.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

export async function launchProfile(dir, baseURL) {
  return chromium.launchPersistentContext(dir, { baseURL, headless: true, viewport: { width: 1280, height: 720 }, acceptDownloads: true });
}

export const newProfileDir = () => mkdtempSync(join(tmpdir(), 'expfw-profile-'));
/** Best effort: Chromium can hold files for a moment after it exits, and this is only a temp folder. */
export function removeProfileDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* left for the OS to clean up */ }
}

/** Kill every browser process that was started with this profile directory. */
export async function killProfile(dir) {
  if (process.platform === 'win32') {
    const needle = dir.replace(/'/g, "''");
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${needle}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
  } else {
    try { execFileSync('pkill', ['-9', '-f', dir]); } catch { /* nothing left to kill */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 1000)); // let the OS release the profile lock
}
