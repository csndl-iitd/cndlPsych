import js from '@eslint/js';
import globals from 'globals';

// Layer rules from CLAUDE.md / ARCHITECTURE.md section 2. Do not weaken these to make
// something compile; tools/check-layers.js enforces the same rules independently
// (and also sees dynamic imports and re-exports).
const SDK_PATTERNS = ['jspsych', 'jspsych/*', '@jspsych/*', 'firebase', 'firebase/*', 'webgazer', 'webgazer/*'];
const JSPSYCH_PATTERNS = ['jspsych', 'jspsych/*', '@jspsych/*'];
// Tests may import across layers (they are not part of the shipped framework).
const TEST_FILES = ['**/*.test.js', '**/*.e2e.js'];
const ALL_LAYERS = ['foundation', 'pipeline', 'storage', 'stage', 'authoring', 'runtime'];

const layerImport = (allowed) => ALL_LAYERS
  .filter((layer) => !allowed.includes(layer))
  .map((layer) => `**/${layer}/**`);

function restrictImports(patterns, message) {
  return { 'no-restricted-imports': ['error', { patterns: [{ group: patterns, message }] }] };
}

// foundation may only import its own siblings ('./x.js'): no packages, no other layers.
const foundationImports = {
  'no-restricted-imports': ['error', { patterns: [{ regex: '^(?!\\./)', message: 'foundation imports nothing outside foundation.' }] }],
};

const importRules = (allowedLayers, extraAllowed = []) => restrictImports(
  [...layerImport(allowedLayers), ...SDK_PATTERNS.filter((p) => !extraAllowed.includes(p))],
  'Layer rule: see CLAUDE.md hard rule 1 and 2.',
);

const dynamicSdkImport = (names) => ({
  selector: `ImportExpression[source.value=/^(${names.join('|')})/]`,
  message: 'Dynamic SDK import is allowed only in storage/firebase.js (firebase) and pipeline/gaze.js (webgazer).',
});

const restrictedGlobals = (names) => names.map((name) => ({
  name,
  message: 'No browser storage in the runtime (CLAUDE.md hard rule 3). IndexedDB only in storage/local.js.',
}));
const noListeners = {
  selector: "CallExpression[callee.property.name=/^(add|remove)EventListener$/]",
  message: 'Raw DOM listeners live only in pipeline/input.js (hard rule 4); use the bus.',
};
const frameworkGlobals = restrictedGlobals(['localStorage', 'sessionStorage', 'indexedDB', 'IDBKeyRange']);
const localStorageGlobals = restrictedGlobals(['localStorage', 'sessionStorage']);

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'spec/schema/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    // `const { a, ...rest } = x` is how code leaves keys out of a copy.
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  {
    // page.evaluate callbacks run in the browser.
    files: ['**/*.e2e.js', 'tools/e2e/**/*.js', 'cli/dry-run.js', 'bundle/**/*.js', 'tools/timing/measure.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['framework/**/*.js'],
    ignores: TEST_FILES,
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-globals': ['error', ...frameworkGlobals],
      'no-restricted-properties': ['error',
        { object: 'window', property: 'localStorage', message: 'No browser storage (hard rule 3).' },
        { object: 'window', property: 'sessionStorage', message: 'No browser storage (hard rule 3).' },
        { object: 'Math', property: 'random', message: 'Use the seeded rng (hard rule 5).' },
      ],
      'no-restricted-syntax': ['error', noListeners, dynamicSdkImport(['firebase', 'webgazer', 'jspsych', '@jspsych'])],
    },
  },
  { files: ['framework/foundation/**/*.js'], ignores: TEST_FILES, rules: foundationImports },
  { files: ['framework/{pipeline,storage,stage}/**/*.js'], ignores: TEST_FILES, rules: importRules(['foundation']) },
  { files: ['framework/authoring/**/*.js'], ignores: TEST_FILES, rules: importRules(['foundation']) },
  { files: ['framework/runtime/**/*.js'], ignores: TEST_FILES, rules: importRules(ALL_LAYERS) },
  {
    files: ['framework/pipeline/bridge.js', 'framework/authoring/modules/*.js'],
    ignores: TEST_FILES,
    rules: restrictImports(
      [...layerImport(['foundation']), ...SDK_PATTERNS.filter((p) => !JSPSYCH_PATTERNS.includes(p))],
      'Only jsPsych may be imported here (hard rule 2).',
    ),
  },
  {
    files: ['framework/storage/firebase.js'],
    rules: {
      'no-restricted-syntax': ['error', noListeners, dynamicSdkImport(['webgazer', 'jspsych', '@jspsych'])],
    },
  },
  {
    files: ['framework/pipeline/gaze.js'],
    rules: {
      'no-restricted-syntax': ['error', noListeners, dynamicSdkImport(['firebase', 'jspsych', '@jspsych'])],
    },
  },
  {
    files: ['framework/pipeline/input.js'],
    rules: { 'no-restricted-syntax': ['error', dynamicSdkImport(['firebase', 'webgazer', 'jspsych', '@jspsych'])] },
  },
  {
    files: ['framework/storage/local.js'],
    rules: {
      'no-restricted-globals': ['error', ...localStorageGlobals],
    },
  },
  {
    // Task and stimulus code: no imports, no globals beyond the injected context.
    files: ['**/custom/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**'], message: 'Custom code imports nothing; use the injected context.' }] }],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded rng (hard rule 5).' }],
      'no-restricted-syntax': ['error',
        { selector: "CallExpression[callee.property.name='addEventListener']", message: 'Tasks never attach DOM listeners (hard rule 4); use bus.on.' },
        { selector: 'ImportExpression', message: 'Custom code imports nothing.' },
      ],
    },
  },
];
