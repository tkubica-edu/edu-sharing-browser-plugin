import { defineConfig } from 'vitest/config';

/**
 * Loaded by `@angular/build:unit-test` (`runnerConfig` in angular.json) for the one thing the builder
 * has no option for: `ngx-edu-sharing-api` is left external by the test build, so Node imports its
 * ESM directly — and it does `import { omit } from 'lodash'`, a CommonJS package Node cannot take
 * named exports from. Inlining the library routes it through Vite, which interops the require.
 *
 * The application build has no such problem: there the library is bundled (and declared under
 * `allowedCommonJsDependencies`).
 */
export default defineConfig({
  test: {
    server: { deps: { inline: ['ngx-edu-sharing-api'] } },
  },
});
