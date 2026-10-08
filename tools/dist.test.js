// The licence boundary: the MIT core bundle must not contain WebGazer (GPL-3.0-or-later), every
// package that is in it must be under a permissive licence and be named in its notices, and the
// add-on folder must carry the GPL text and the source pointers.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const OUT = mkdtempSync(join(tmpdir(), 'expfw-dist-'));
const CORE = join(OUT, 'expfw');
const ADDON = join(OUT, 'expfw-eyetracking');
// A message only WebGazer contains (minified code keeps string literals).
const WEBGAZER_MARKER = 'WebGazer works only over https';
const PERMISSIVE = /^(MIT|ISC|BSD-[23]-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|Python-2\.0|\(MIT OR CC0-1\.0\)|Apache-2\.0 AND MIT)$/;

const scripts = (dir) => readdirSync(dir, { recursive: true }).filter((name) => name.endsWith('.js')).map((name) => readFileSync(join(dir, name), 'utf8'));
const licenceLines = (text) => [...text.matchAll(/^(\S+) (\S+) {2}\((.+)\)$/gm)].map(([, name, version, licence]) => ({ name, version, licence }));

beforeAll(() => { execFileSync(process.execPath, [join(ROOT, 'tools', 'build-dist.js')], { stdio: 'pipe', env: { ...process.env, EXPFW_DIST_DIR: OUT } }); }, 120_000);
afterAll(() => rmSync(OUT, { recursive: true, force: true }));

describe('core bundle (dist/expfw)', () => {
  it('has boot.js and a parts/ folder with readable names, nothing else loose', () => {
    expect(readdirSync(CORE).sort()).toEqual(['LICENSE', 'README.txt', 'THIRD-PARTY-LICENSES.txt', 'VERSION', 'boot.js', 'parts']);
    const parts = readdirSync(join(CORE, 'parts'));
    expect(parts.every((name) => /^(firebase-(app|app-check|auth|firestore)|eyetracking-stub|chunk)-[A-Z0-9]+\.js$/.test(name)), parts.join(', ')).toBe(true);
    for (const wanted of ['firebase-app', 'firebase-auth', 'firebase-firestore', 'eyetracking-stub']) expect(parts.some((name) => name.startsWith(`${wanted}-`)), wanted).toBe(true);
  });

  it('contains no WebGazer', () => {
    for (const code of scripts(CORE)) {
      expect(code).not.toContain(WEBGAZER_MARKER);
    }
    expect(existsSync(join(CORE, 'mediapipe'))).toBe(false);
  });

  it('looks for the add-on folder next to itself', () => {
    expect(scripts(CORE).some((code) => code.includes('expfw-eyetracking/webgazer.js'))).toBe(true);
  });

  it('is MIT, and names every bundled package with a permissive licence', () => {
    expect(readFileSync(join(CORE, 'LICENSE'), 'utf8')).toMatch(/^MIT License/);
    const listed = licenceLines(readFileSync(join(CORE, 'THIRD-PARTY-LICENSES.txt'), 'utf8'));
    expect(listed.length).toBeGreaterThan(10);
    expect(listed.filter((p) => !PERMISSIVE.test(p.licence)).map((p) => `${p.name} (${p.licence})`)).toEqual([]);
    expect(listed.map((p) => p.name)).toEqual(expect.arrayContaining(['jspsych', 'js-yaml', 'ajv']));
    expect(listed.map((p) => p.name)).not.toContain('webgazer');
  });
});

describe('eye tracking add-on (dist/expfw-eyetracking)', () => {
  it('is WebGazer with its face model, the GPL text and the source pointers', () => {
    expect(existsSync(join(ADDON, 'webgazer.js'))).toBe(true);
    expect(scripts(ADDON).some((code) => code.includes(WEBGAZER_MARKER))).toBe(true);
    expect(existsSync(join(ADDON, 'mediapipe', 'face_mesh', 'face_mesh.binarypb'))).toBe(true);
    expect(readFileSync(join(ADDON, 'LICENSE.md'), 'utf8')).toContain('GNU General Public License');
    const readme = readFileSync(join(ADDON, 'README.md'), 'utf8');
    expect(readme).toContain('GNU General Public License');
    expect(readme).toContain('github.com/brownhci/WebGazer');
  });

  it('lists webgazer among its packages with the GPL licence', () => {
    const listed = licenceLines(readFileSync(join(ADDON, 'THIRD-PARTY-LICENSES.txt'), 'utf8'));
    expect(listed.find((p) => p.name === 'webgazer')?.licence).toBe('GPL-3.0-or-later');
  });
});

describe('repository', () => {
  it('declares MIT and the only non-permissive production dependency is webgazer', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(manifest.license).toBe('MIT');
    const gpl = Object.keys(manifest.dependencies).filter((name) => /GPL/.test(JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).license ?? ''));
    expect(gpl).toEqual(['webgazer']);
  });
});
