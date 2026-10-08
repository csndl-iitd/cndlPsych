// The shape of what ships (dist/expfw and dist/expfw-eyetracking): readable source with the same
// layout as the repository, no generated names, a complete import map, and the licence boundary
// (the MIT core must not contain WebGazer, which is GPL-3.0-or-later).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VENDOR } from '../bundle/vendor.js';

const ROOT = join(import.meta.dirname, '..');
const OUT = mkdtempSync(join(tmpdir(), 'expfw-dist-'));
const CORE = join(OUT, 'expfw');
const ADDON = join(OUT, 'expfw-eyetracking');
// A message only WebGazer contains.
const WEBGAZER_MARKER = 'WebGazer works only over https';
const PERMISSIVE = /^(MIT|ISC|BSD-[23]-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|Python-2\.0|\(MIT OR CC0-1\.0\)|Apache-2\.0 AND MIT)$/;

const files = (dir, test = () => true) => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1).replace(/\\/g, '/'))
  .filter(test)
  .sort();
const text = (path) => readFileSync(path, 'utf8');
const licenceLines = (content) => [...content.matchAll(/^(\S+) (\S+) {2}\((.+)\)$/gm)].map(([, name, version, licence]) => ({ name, version, licence }));
const isSource = (name) => name.endsWith('.js') && !/\.(test|e2e)\.js$/.test(name);

/** Module specifiers a file imports: static `from '...'`, side-effect `import '...'`, and `import('...')`. */
const specifiers = (source) => [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g)].map((match) => match[1]);

/** The import map boot.js builds, by running it against a minimal page. */
function importMapOf(bootSource, scriptUrl) {
  const appended = [];
  const document = { currentScript: { src: scriptUrl }, createElement: () => ({}), head: { append: (node) => appended.push(node) } };
  vm.runInNewContext(bootSource, { document, URL });
  return JSON.parse(appended.find((node) => node.type === 'importmap').textContent).imports;
}

beforeAll(() => { execFileSync(process.execPath, [join(ROOT, 'tools', 'build-dist.js')], { stdio: 'pipe', env: { ...process.env, EXPFW_DIST_DIR: OUT } }); }, 120_000);
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

describe('expfw/ layout', () => {
  it('has the entry files, the layers, schemas, vendor code and notices, and nothing else at the top', () => {
    expect(readdirSync(CORE).sort()).toEqual(['LICENSE', 'README.txt', 'THIRD-PARTY-LICENSES.txt', 'VERSION', 'boot.js', 'framework', 'schemas', 'start.js', 'types.d.ts', 'vendor']);
    expect(readdirSync(join(CORE, 'framework')).sort()).toEqual(['authoring', 'foundation', 'pipeline', 'runtime', 'stage', 'storage']);
  });

  it('ships exactly the framework sources of the repository (no tests), byte for byte apart from line endings', () => {
    const source = files(join(ROOT, 'framework'), isSource);
    expect(files(join(CORE, 'framework'))).toEqual(source);
    for (const name of source) expect(text(join(CORE, 'framework', name)), name).toBe(text(join(ROOT, 'framework', name)).replace(/\r\n/g, '\n'));
  });

  it('has no generated names: no hashes, no chunk or index files', () => {
    const odd = files(CORE).filter((name) => /-[A-Z0-9]{8}\.(js|css)$|^chunk-|\/chunk-|index\.esm/.test(name));
    expect(odd).toEqual([]);
  });

  it('is readable: nothing is minified (lines are short on average, and our own files have no long line)', () => {
    for (const name of files(CORE, (n) => n.endsWith('.js'))) {
      const content = text(join(CORE, name));
      const lines = content.split('\n');
      expect(content.length / lines.length, `${name}: average line length`).toBeLessThan(120);
      if (!name.startsWith('vendor/')) expect(Math.max(...lines.map((line) => line.length)), `${name}: longest line`).toBeLessThan(400);
    }
  });

  it('every relative import in the shipped modules points at a file that is shipped', () => {
    for (const name of files(CORE, (n) => n.endsWith('.js') && !n.startsWith('vendor/'))) {
      for (const spec of specifiers(text(join(CORE, name))).filter((s) => s.startsWith('.'))) {
        expect(existsSync(resolve(dirname(join(CORE, name)), spec)), `${name} imports ${spec}`).toBe(true);
      }
    }
  });
});

describe('import map (boot.js)', () => {
  const map = () => importMapOf(text(join(CORE, 'boot.js')), 'http://host/study/expfw/boot.js');

  it('points each third-party module name at the vendor file that bundle/vendor.js builds for it', () => {
    const imports = map();
    for (const vendor of VENDOR) {
      expect(existsSync(join(CORE, 'vendor', vendor.file)), vendor.file).toBe(true);
      for (const specifier of vendor.specifiers) expect(imports[specifier], specifier).toBe(`http://host/study/expfw/vendor/${vendor.file}`);
    }
  });

  it('maps webgazer to the add-on folder next to expfw/', () => {
    expect(map().webgazer).toBe('http://host/study/expfw-eyetracking/webgazer.js');
  });

  it('covers every bare module name the shipped code imports', () => {
    const covered = new Set(Object.keys(map()));
    const bare = new Set();
    for (const name of files(CORE, (n) => n.endsWith('.js') && !n.startsWith('vendor/'))) {
      for (const spec of specifiers(text(join(CORE, name)))) {
        if (!spec.startsWith('.') && !spec.startsWith('/') && !/^https?:/.test(spec) && !spec.startsWith('node:')) bare.add(spec);
      }
    }
    expect([...bare].filter((spec) => !covered.has(spec))).toEqual([]);
    for (const vendor of VENDOR) {
      for (const name of vendor.external ?? []) expect(covered.has(name), `${vendor.file} needs ${name}`).toBe(true);
    }
  });
});

describe('schemas', () => {
  it('index.json lists every schema file, and they are the generated ones', () => {
    const listed = JSON.parse(text(join(CORE, 'schemas', 'index.json')));
    expect(listed).toEqual(files(join(ROOT, 'spec', 'schema'), (n) => n.endsWith('.schema.json')));
    expect(files(join(CORE, 'schemas')).filter((n) => n !== 'index.json')).toEqual(listed);
  });
});

describe('licences', () => {
  it('the core is MIT, contains no WebGazer, and names every vendored package with a permissive licence', () => {
    expect(text(join(CORE, 'LICENSE'))).toMatch(/^MIT License/);
    for (const name of files(CORE, (n) => n.endsWith('.js'))) expect(text(join(CORE, name)), name).not.toContain(WEBGAZER_MARKER);
    expect(existsSync(join(CORE, 'mediapipe'))).toBe(false);
    const listed = licenceLines(text(join(CORE, 'THIRD-PARTY-LICENSES.txt')));
    expect(listed.length).toBeGreaterThan(10);
    expect(listed.filter((p) => !PERMISSIVE.test(p.licence)).map((p) => `${p.name} (${p.licence})`)).toEqual([]);
    expect(listed.map((p) => p.name)).toEqual(expect.arrayContaining(['jspsych', 'js-yaml', 'ajv', 'firebase']));
    expect(listed.map((p) => p.name)).not.toContain('webgazer');
  });

  it('the add-on is WebGazer with its face model, the GPL text and the source pointers', () => {
    expect(existsSync(join(ADDON, 'webgazer.js'))).toBe(true);
    expect(text(join(ADDON, 'webgazer.js'))).toContain(WEBGAZER_MARKER);
    expect(existsSync(join(ADDON, 'mediapipe', 'face_mesh', 'face_mesh.binarypb'))).toBe(true);
    expect(text(join(ADDON, 'LICENSE.md'))).toContain('GNU General Public License');
    const readme = text(join(ADDON, 'README.md'));
    expect(readme).toContain('GNU General Public License');
    expect(readme).toContain('github.com/brownhci/WebGazer');
    expect(licenceLines(text(join(ADDON, 'THIRD-PARTY-LICENSES.txt'))).find((p) => p.name === 'webgazer')?.licence).toBe('GPL-3.0-or-later');
  });

  it('the repository declares MIT and the only non-permissive production dependency is webgazer', () => {
    const manifest = JSON.parse(text(join(ROOT, 'package.json')));
    expect(manifest.license).toBe('MIT');
    const gpl = Object.keys(manifest.dependencies).filter((name) => /GPL/.test(JSON.parse(text(join(ROOT, 'node_modules', name, 'package.json'))).license ?? ''));
    expect(gpl).toEqual(['webgazer']);
  });
});
