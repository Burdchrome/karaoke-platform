// ESLint flat config — like knip.jsonc, this doubles as a map of the repo:
// which files run in Node, which run in the browser. ESLint uses it to know
// which globals are legit (e.g. `process` in server code, `document` in
// frontend code) so anything else undefined is a real bug.
import js from '@eslint/js';
import globals from 'globals';
import pluginPromise from 'eslint-plugin-promise';
import pluginN from 'eslint-plugin-n';

export default [
  js.configs.recommended,
  // Promise hygiene everywhere — dropped .catch()/misused chains are
  // silent failures in JS; these rules catch them from syntax alone.
  pluginPromise.configs['flat/recommended'],
  {
    // Server + CLI scripts run under Node (ESM — rules only, not the
    // preset's languageOptions, which would clobber sourceType/globals)
    files: ['server/**/*.js', 'scripts/**/*.{js,cjs}'],
    languageOptions: { globals: globals.node },
    plugins: { n: pluginN },
    // Node-specific rules: missing .js extensions in ESM imports,
    // APIs newer than the engine, unpublished requires.
    rules: pluginN.configs['flat/recommended-module'].rules,
  },
  {
    // CLI tools: exiting with a status code is the job — the no-process-exit
    // hazard (skipping cleanup) applies to the long-running server, not here.
    files: ['scripts/**/*.{js,cjs}'],
    rules: { 'n/no-process-exit': 'off' },
  },
  {
    // Frontend runs in the browser
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
];
