// Service-worker loader (Chrome, Edge, Safari): loads polyfill, config, then the
// background logic. Firefox loads the same files via manifest background.scripts.
importScripts(
  'vendor/browser-polyfill.min.js',
  'config.js',
  'background/background.js'
);
