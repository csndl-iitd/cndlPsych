// The third-party code the framework imports, and the file each import resolves to in the
// shipped folder (expfw/vendor/). tools/build-dist.js builds these files from node_modules;
// bundle/boot.js maps the module names to them in the browser. A test keeps the two in step.
//
// Each file is one package (or, for Firebase, one SDK) turned into a single readable ES module.
// A package that another one imports (jspsych) is left as an import, so there is one copy.

/**
 * @typedef {object} VendorFile
 * @property {string} file name inside expfw/vendor/
 * @property {string[]} specifiers the module names that resolve to it
 * @property {string} entry source of the module to build (what it re-exports)
 * @property {string[]} [external] module names it imports from other vendor files
 */

/** @type {VendorFile[]} */
export const VENDOR = [
  { file: 'jspsych.js', specifiers: ['jspsych'], entry: "export * from 'jspsych';" },
  {
    file: 'jspsych-plugin-html-keyboard-response.js',
    specifiers: ['@jspsych/plugin-html-keyboard-response'],
    entry: "export { default } from '@jspsych/plugin-html-keyboard-response';",
    external: ['jspsych'],
  },
  {
    file: 'jspsych-plugin-survey.js',
    specifiers: ['@jspsych/plugin-survey'],
    entry: "export { default } from '@jspsych/plugin-survey';",
    external: ['jspsych'],
  },
  { file: 'js-yaml.js', specifiers: ['js-yaml'], entry: "export * from 'js-yaml';" },
  { file: 'ajv.js', specifiers: ['ajv'], entry: "export { default } from 'ajv';" },
  {
    // One file for the SDK: the parts share state (the app registry), so they must be one copy.
    file: 'firebase.js',
    specifiers: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/app-check'],
    entry: ['app', 'auth', 'firestore', 'app-check'].map((part) => `export * from 'firebase/${part}';`).join('\n'),
  },
];

/** The stylesheet of the survey plugin, shipped next to the vendor modules. */
export const SURVEY_CSS = { from: '@jspsych/plugin-survey/css/survey.css', file: 'jspsych-plugin-survey.css' };
