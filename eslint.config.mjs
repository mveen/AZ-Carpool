// eslint.config.mjs: two rules only (no-undef, no-unused-vars), run by `bash scripts/run-lint.sh` and in CI (.github/workflows/lint.yml).
// Goal: catch a misspelled name or a forgotten import before it reaches the site. Not a style check.
// ESLint is not a dependency of the repo (it has no npm dependencies); the script installs it in a temporary folder.
const platform = Object.fromEntries([
  // browser
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'self', 'Notification', 'Event', 'Blob', 'Response', 'btoa', 'atob',
  // browser and node
  'fetch', 'URL', 'URLSearchParams', 'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder', 'crypto', 'structuredClone', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  // node only (cron/, scripts/, tests/)
  'process', 'Buffer', 'setImmediate',
].map(name => [name, 'readonly']));

export default [
  { ignores: ['firebase-sdk/**', 'dist/**', 'dist-test/**', 'dist-cron/**', 'Claude outputs/**', 'node_modules/**', 'deploy/**', 'backups/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: platform },
    rules: {
      'no-undef': 'error',
      // Arguments, caught errors (`catch(e){}`) and names starting with _ are left alone on purpose: they are how this code is written.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
  // The tests: unused helpers in a test file are harmless noise, a misspelled name is not.
  { files: ['tests/**', 'firebase/rules-test/**'], rules: { 'no-unused-vars': 'off' } },
];
