# Build & release

- [Building](#building)
- [What goes into the package](#what-goes-into-the-package)
- [Prebuilt downloads](#prebuilt-downloads)
- [Cutting a release](#cutting-a-release)

---

## Building

```bash
npm install            # build harness deps (archiver, web-ext, polyfill)
npm run install:app    # Angular app deps (app-src/)
npm run build          # ng build + assemble dist/{chrome,firefox,safari}
```

Useful variants:

- `npm run build:chrome` / `:firefox` / `:safari` — single target.
- `npm run dev:firefox` / `dev:chrome` — watch mode, see [TESTING.md § Watch mode](TESTING.md#watch-mode-rebuild-on-every-change).
- `npm run build:no-ng` — reuse the last Angular build (skip `ng build`).
- `npm run lint:firefox` — `web-ext lint` on the Firefox build.

Output: `dist/chrome/`, `dist/firefox/`, `dist/safari/` (+ `.zip` for chrome/firefox). Edge uses the
**Chrome** build (Chromium — no separate target).

The manifest is assembled per target from `manifest.base.json` plus `manifest.<target>.json`, which
is where the targets differ: Chrome and Safari get a `service_worker` (`sw.js`), Firefox gets
`background.scripts` (an event page) and its `browser_specific_settings`.

The base manifest's `extension_pages` CSP keeps `script-src` at `'self'` and adds
`'wasm-unsafe-eval'`, which is what lets the sidebar compile the ONNX runtime the 3D conversion runs
on (`DepthModelService`). It permits compiling WebAssembly and nothing else — scripts still have to
come from the package. The runtime's WASM binary is therefore fetched as data and handed over as
`env.wasm.wasmBinary` rather than loaded by URL, and it runs single-threaded, since its worker pool
would start from a `blob:` URL that `script-src 'self'` forbids.

pdf.js runs under that same `script-src 'self'`, which is why its worker is part of the package:
`app-src/angular.json` copies `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` (1.2 MB) beside the
sidebar's own files as a build asset, and `PdfTextService` points `GlobalWorkerOptions.workerSrc` at
it relative to `document.baseURI`. A worker from a CDN would be refused, and the point of reading a
document here is that nothing about it leaves the device anyway. Like the sidebar's JavaScript the
copied worker is build output and untracked (`.gitignore`: `sidebar/*.mjs`); the library itself is a
lazy chunk, so it is loaded only once a PDF is actually read.

Changes to the Angular app only reach the loaded extension through a build — `ng build` in
`app-src/` alone is not enough, since `scripts/build.mjs` is what refreshes `sidebar/` and assembles
`dist/`.

## What goes into the package

`scripts/edu/`, `scripts/wlo/` and `scripts/boerdi/` are prebuilt web-component bundles, copied
verbatim to `dist/<target>/{edu,wlo,boerdi}/`. Their contents are not ours to shape — `scripts/edu/`
is the output of an edu-sharing Frontend build and is taken over as a whole, third-party libraries
and all. See [WEB-COMPONENTS.md](WEB-COMPONENTS.md).

The one exception is `BUNDLE_EXCLUDES` in `scripts/build.mjs`, a per-bundle list of paths that are
skipped while copying:

| Path | Size | Why it is left out |
| --- | --- | --- |
| `edu/assets/monaco` | 16 MB | The Monaco editor is pulled in by `chunk-BQCCT6S5.js` (`ngx-monaco-editor-v2`), which only the bundle's `admin-page` and `embed-page` lazy routes import. The extension loads the fixed entry points `styles.css`, `scripts.js`, `polyfills.js`, `main.js` and then mounts custom elements (`app-src/src/app/services/web-component-bundle.service.ts`) — it never starts the bundle's router, so neither route is reachable. Monaco's `ts.worker-*.js` is 6.7 MB, above the 5 MB addons-linter can parse, and made `web-ext lint` fail with `FILE_TOO_LARGE`. |

That leaves `scripts/edu/` at 66 MB in the repo and each `dist/<target>/` at 54 MB (16 MB zipped).
Refreshing a bundle is still a plain overwrite of `scripts/<name>/` — the exclusion names a
directory, so a new build's renamed chunks and workers are covered too. The boerdi widget has a
script for that overwrite, see
[WEB-COMPONENTS.md § Refreshing a bundle](WEB-COMPONENTS.md#refreshing-a-bundle). What stays and why
is [TROUBLESHOOTING.md § Bundle size](TROUBLESHOOTING.md#bundle-size).

## Prebuilt downloads

Every push builds all three targets on CI (`.github/workflows/build.yml`); the runs under *Actions*
carry the unpacked builds as artifacts. Tagged versions (`v*`) also publish a GitHub **Release** with
`edu-sharing-{chrome,firefox,safari}-<version>.zip` attached — those need no login and are the ones
to hand to testers. Loading them is the same as loading a local build, see
[TESTING.md](TESTING.md#load-the-extension).

## Cutting a release

A pushed `v*` tag is the whole trigger — CI builds, zips and publishes on its own. One-time
prerequisite: *Settings → Actions → General → Workflow permissions* must be **Read and write**,
otherwise `gh release create` fails with a 403.

1. Set the new version:
   ```bash
   npm run version:set -- 0.2.0
   ```
   `scripts/version.mjs` takes one `x.y.z` argument and writes `"version"` in **both**
   `package.json` and `manifest.base.json` — they are maintained by hand and are not synced — then
   runs `npm install` so `package-lock.json` follows. It touches no git state; it ends by printing
   the tag commands for step 3. Bumping the manifest matters: Chrome and Firefox refuse to install
   an unchanged version number as an update. The workflow only warns when the tag and
   `manifest.base.json` disagree, it does not stop.

   The per-browser `manifest.<target>.json` overlays carry no `version` of their own — they inherit
   it from the base manifest at assembly time.
2. Commit the bump and push it.
3. Tag and push the tag:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

The build takes a few minutes and then a published release appears with
`edu-sharing-{chrome,firefox,safari}-0.2.0.zip` attached.

If a tagged run fails, delete tag and release before retrying — the workflow will not overwrite an
existing release:

```bash
git push origin :v0.2.0 && git tag -d v0.2.0
gh release delete v0.2.0
```
