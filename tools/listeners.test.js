import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LISTENER = /\b(add|remove)EventListener\b|\bon(click|dblclick|key[a-z]*|pointer[a-z]*|mouse[a-z]*|touch[a-z]*|wheel|contextmenu|blur|focus)\s*=[^=]/;

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (name.endsWith('.js') && !/\.(test|e2e)\.js$/.test(name)) yield path;
  }
}
const relativePath = (path) => relative(ROOT, path).split(sep).join('/');

describe('no raw DOM listeners outside input.js (hard rule 4)', () => {
  it('only framework/pipeline/input.js attaches listeners', () => {
    const offenders = [...sources(join(ROOT, 'framework'))]
      .filter((path) => LISTENER.test(readFileSync(path, 'utf8')))
      .map(relativePath);
    expect(offenders).toEqual(['framework/pipeline/input.js']);
  });

  it('custom code (examples) attaches none either', () => {
    const offenders = [...sources(join(ROOT, 'spec', 'examples', 'custom'))]
      .filter((path) => LISTENER.test(readFileSync(path, 'utf8')))
      .map(relativePath);
    expect(offenders).toEqual([]);
  });

  it('the pattern really detects the forms it is meant to catch', () => {
    for (const text of ['el.addEventListener("click", f)', 'x.removeEventListener(a, b)', 'el.onclick = f;', 'window.onkeydown = f', 'el.onpointerdown=f']) {
      expect(LISTENER.test(text), text).toBe(true);
    }
    for (const text of ['const onClickHandler = 1', 'a.on("input.tap", f)', 'if (x.onload === y) {}']) {
      expect(LISTENER.test(text), text).toBe(false);
    }
  });
});
