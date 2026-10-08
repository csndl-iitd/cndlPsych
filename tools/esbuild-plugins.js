// Bundler plugins shared by the user build and the browser-test build.
import { readFile } from 'node:fs/promises';

/**
 * The survey stylesheet loads "Open Sans" from fonts.gstatic.com. That would send every
 * participant's address to Google and fail offline, so those @font-face rules are removed
 * and the page uses the system font stack instead. CSS is bundled as text.
 */
export const localFontsOnly = {
  name: 'local-fonts-only',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async ({ path }) => {
      const css = await readFile(path, 'utf8');
      return { contents: css.replace(/@font-face\s*\{[^}]*https?:\/\/[^}]*\}/g, ''), loader: 'text' };
    });
  },
};

/**
 * Make `import('webgazer')` in framework code resolve to the add-on's entry (which wraps the real
 * package), so test bundles get the same module shape as the add-on folder. The entry itself imports
 * the real package.
 */
export function webgazerAddOn(entry) {
  return {
    name: 'webgazer-add-on',
    setup(build) {
      build.onResolve({ filter: /^webgazer$/ }, (args) => (args.importer === entry ? undefined : { path: entry }));
    },
  };
}

/**
 * Give the lazily loaded Firebase SDK files readable names (parts/firebase-firestore-<hash>.js
 * instead of index.esm-<hash>.js). The framework's `import('firebase/firestore')` is pointed at a
 * one-line wrapper module; the wrapper itself imports the real package.
 */
export function namedFirebaseParts(partsDir) {
  return {
    name: 'named-firebase-parts',
    setup(build) {
      build.onResolve({ filter: /^firebase\/(app|firestore|auth|app-check)$/ }, (args) => {
        if (args.importer.startsWith(partsDir)) return undefined;
        return { path: `${partsDir}/firebase-${args.path.slice('firebase/'.length)}.js` };
      });
    },
  };
}
