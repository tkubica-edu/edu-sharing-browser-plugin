// Service-worker loader (Chrome, Edge, Safari): loads polyfill, config, the dev-mode
// fixtures, then the background logic. Firefox loads the same files via manifest
// background.scripts.
importScripts(
  'vendor/browser-polyfill.min.js',
  'config.js',
  'background/dev-fixtures.js',
  'background/background.js'
);
