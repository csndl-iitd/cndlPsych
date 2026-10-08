// Third-party licence notices for a bundle: every package esbuild put in it, with its
// licence text, so the files we ship carry what their licences require.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const NODE_MODULES = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/;

/** @param {object} metafile esbuild's metafile (build with `metafile: true`) */
export function bundledPackages(metafile) {
  const names = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const match = NODE_MODULES.exec(input);
    if (match) names.add(match[1].replace('\\', '/'));
  }
  return [...names].sort();
}

function licenceText(dir) {
  const file = readdirSync(dir).find((name) => /^(licen[sc]e|copying)/i.test(name));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

/** The notices file: one section per package with name, version, licence and the licence text if the package has one. */
export function noticesFor(packages, heading) {
  const sections = packages.map((name) => {
    const dir = join(root, 'node_modules', name);
    if (!existsSync(join(dir, 'package.json'))) return `${name}\n(not found in node_modules)`;
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const text = licenceText(dir);
    return `${'-'.repeat(78)}\n${manifest.name} ${manifest.version}  (${manifest.license ?? 'see package'})\n${text ? `\n${text}\n` : ''}`;
  });
  return `${heading}\n\n${sections.join('\n')}\n`;
}
