// Test support for projects made by `init`: they start with the live / test mode screen, which most browser
// tests are not about; `quietMode` switches it off (the mode tests do not call it).
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

export function quietMode(dir) {
  appendFileSync(join(dir, 'experiment.yaml'), '\nmodes: { enabled: false }\n');
}
