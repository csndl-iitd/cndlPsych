// Bundler plugins shared by the user build and the browser-test build.
import { readFile } from 'node:fs/promises';

/** Remove the @font-face rules that load fonts from the web (see localFontsOnly). */
export function stripRemoteFonts(css) {
  return css.replace(/@font-face\s*\{[^}]*https?:\/\/[^}]*\}/g, '');
}

/**
 * The survey stylesheet loads "Open Sans" from fonts.gstatic.com. That would send every
 * participant's address to Google and fail offline, so those @font-face rules are removed
 * and the page uses the system font stack instead. CSS is bundled as text.
 */
export const localFontsOnly = {
  name: 'local-fonts-only',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async ({ path }) => ({ contents: stripRemoteFonts(await readFile(path, 'utf8')), loader: 'text' }));
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
