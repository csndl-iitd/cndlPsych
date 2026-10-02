// The Firestore emulator for tests, without firebase-tools: a portable Java runtime and the
// emulator JAR are downloaded once into .tools/ (git-ignored), and the JAR is started
// directly. Rules are loaded over the emulator's REST API by @firebase/rules-unit-testing.
//
//   node tools/emulator.js        download what is missing and print the paths
//
// Sources: Eclipse Temurin (Adoptium) JRE 21 and Google's firebase-preview-drop bucket,
// the same place firebase-tools downloads the emulator from.
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLS = join(ROOT, '.tools');
export const EMULATOR_VERSION = '1.20.2';
const JAR = join(TOOLS, `cloud-firestore-emulator-v${EMULATOR_VERSION}.jar`);
const JAR_URL = `https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v${EMULATOR_VERSION}.jar`;
const JRE_DIR = join(TOOLS, 'jre');

const PLATFORM = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
const ARCH = { x64: 'x64', arm64: 'aarch64' }[process.arch];
const JRE_URL = `https://api.adoptium.net/v3/binary/latest/21/ga/${PLATFORM}/${ARCH}/jre/hotspot/normal/eclipse`;

async function download(url, path) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  await pipeline(response.body, createWriteStream(path));
}

function findJava() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = walk(path);
        if (found) return found;
      } else if (entry.name === exe && dirname(path).endsWith('bin')) {
        return path;
      }
    }
    return null;
  };
  return existsSync(JRE_DIR) ? walk(JRE_DIR) : null;
}

/** Download the JRE and the emulator if they are not there yet. @returns {Promise<{java: string, jar: string}>} */
export async function ensureTools(log = console.log) {
  mkdirSync(TOOLS, { recursive: true });
  let java = findJava();
  if (!java) {
    log(`downloading a Java 21 runtime (Temurin) into ${JRE_DIR}`);
    const archive = join(TOOLS, process.platform === 'win32' ? 'jre.zip' : 'jre.tar.gz');
    await download(JRE_URL, archive);
    mkdirSync(JRE_DIR, { recursive: true });
    await new Promise((resolve, reject) => {
      // On Windows use the system bsdtar (it reads zip); a tar from Git Bash cannot.
      const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'tar';
      const extract = spawn(tar, process.platform === 'win32' ? ['-xf', archive, '-C', JRE_DIR] : ['-xzf', archive, '-C', JRE_DIR], { stdio: 'inherit' });
      extract.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}`))));
    });
    rmSync(archive);
    java = findJava();
    if (!java) throw new Error('the downloaded Java runtime has no bin/java');
  }
  if (!existsSync(JAR)) {
    log(`downloading the Firestore emulator ${EMULATOR_VERSION}`);
    await download(JAR_URL, JAR);
  }
  return { java, jar: JAR };
}

const portOpen = (port, host) => new Promise((resolve) => {
  const socket = net.connect(port, host);
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});

/**
 * Start the Firestore emulator and wait until it accepts connections.
 * @returns {Promise<{host: string, port: number, stop: () => Promise<void>}>}
 */
export async function startFirestoreEmulator({ port = 8080, host = '127.0.0.1', timeoutMs = 60_000 } = {}) {
  const { java, jar } = await ensureTools();
  const child = spawn(java, ['-jar', jar, `--host=${host}`, `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  let exited = false;
  child.on('exit', () => { exited = true; });

  const deadline = Date.now() + timeoutMs;
  while (!(await portOpen(port, host))) {
    if (exited) throw new Error(`the emulator exited early:\n${output}`);
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`the emulator did not start within ${timeoutMs} ms:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    host,
    port,
    stop: () => new Promise((resolve) => {
      if (exited) { resolve(); return; }
      child.once('exit', resolve);
      child.kill();
    }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ensureTools().then((tools) => console.log(tools));
}
