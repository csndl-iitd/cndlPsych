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
