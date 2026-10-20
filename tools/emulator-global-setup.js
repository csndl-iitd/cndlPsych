// Vitest global setup: start the Firestore emulator once for all emulator tests.
import { startFirestoreEmulator } from './emulator.js';

const PORT = 8089;

export async function setup() {
  const emulator = await startFirestoreEmulator({ port: PORT });
  process.env.CNDLPSYCH_FIRESTORE_HOST = emulator.host;
  process.env.CNDLPSYCH_FIRESTORE_PORT = String(emulator.port);
  return async () => { await emulator.stop(); };
}
