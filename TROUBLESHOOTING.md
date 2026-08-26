# Known issues & caveats

What is known not to work, known to be unverified, or known to look wrong at first sight.

- [Browser-specific](#browser-specific)
- [Permissions](#permissions)
- [Dependencies and runtime limits](#dependencies-and-runtime-limits)
- [Bundle size](#bundle-size)
- [Lint output](#lint-output)

---

## Browser-specific

- **Safari**: the `host_permissions` CORS bypass for extension pages is unreliable, and ITP may block
  the repository session cookie in the injected-panel context. Guest Erschließung (via the background
  worker) is unaffected; logged-in auth needs verification on Safari and may require a background
  auth fallback.
- **Firefox: „Could not establish connection. Receiving end does not exist."** The panel's message
  to the background worker occasionally finds no receiver, most often on a page the panel was
  restored onto after a navigation. It is not the event page having been suspended — it happens with
  a DevTools toolbox attached, which Firefox keeps the page alive for. The send path retries such a
  rejection (`BrowserExtensionService.ask`), which covers it in practice; when the retries are used
  up the panel logs `[edu-sharing][worker] «<action>» not delivered in N attempts` and asks the user
  to reopen the panel. A run that reaches that line is the case still to be explained. Only wordings
  that mean the message never ran are retried — a port that closed mid-answer is reported, since the
  action behind it may have written something.
- **MDS editor rendering needs verification in a real browser.** Two things must hold: (1) the
  vendored bundle boots under the extension CSP (`script-src 'self'` — its core has no `eval`; only
  unused PDF/Cordova *assets* do), and (2) the editor can fetch the MDS definition from the
  repository (CORS/auth). Load the unpacked extension and run an Erschließung to confirm.

## Permissions

- **Broad permissions** (`host_permissions: https://*/*`, `connect-src https:`) are required because
  the repository URL is user-editable; expect stricter store review. `connect-src` also names `wss:`
  and `ws:`, for the nostr relay a content is published to (see
  [FEATURES.md § An Nostr Relay weiterleiten](FEATURES.md#an-nostr-relay-weiterleiten)): the relay
  address is user-editable for the same reason the repository URL is, and a WebSocket is the only
  transport nostr has. It also allows
  `data:` and `blob:`, because the bundle reads a picture it was handed as a URL of its own: the
  preview widget `fetch`es the picked node's inline `preview.data` (a data URL) to turn it into a
  file, and the panel does the same with the object URL of a picture picked in the widget
  (`CurationService`). `img-src` allows `blob:` for the same reason — a panel-created object URL is
  rendered as an image.
- **Reading the clipboard** takes two grants, both for one option of the preview widget: it offers
  *Aus der Zwischenablage einfügen* only while it can see an image on the clipboard, which it answers
  with `navigator.permissions.query({name: 'clipboard-read'})` plus a `clipboard.read()`. The
  extension declares `clipboardRead` (Chrome answers that query with `denied` without it), and the
  panel's iframe is opened with `allow="clipboard-read; clipboard-write"` (the permissions policy
  defaults to the top-level document, so the frame is refused otherwise — see
  `content/panel-host.js`). Pasting itself needs neither: the widget listens for the `paste` event as
  well, which is why Cmd+V worked all along.

## Dependencies and runtime limits

- **`ngx-edu-sharing-api`** (11.0.2) is Angular-only and declares a peer dep of Angular >= 18, while
  the app runs Angular 21, so installing needs `legacy-peer-deps=true` (set in `app-src/.npmrc`). It
  is used for login, node create/update/read, and adding collection references; the last one goes
  through `CollectionServiceUnwrapped`, since the exported `CollectionService` wrapper is read-only.
- **`ngx-edu-sharing-api` imports `lodash` without declaring it.** `omit` is pulled in by its
  `fesm2022` bundle while the library's `package.json` lists neither a dependency nor a peer
  dependency for it, so `app-src/package.json` carries `lodash` itself. Without that entry nothing
  in `app-src/node_modules` resolves the import: the repo root's copy — hoisted out of `web-ext` —
  covers it only for a checkout that installed the root dependencies too, which the CI `test` job
  does not. The same import is what makes the Angular build report `Module 'lodash' … is not ESM`,
  and it is what `app-src/vitest.config.ts` inlines the library for, see
  [TESTING.md § Unit tests](TESTING.md#unit-tests).
- **A resolved node can hide the panel's own text.** The KI check hands the content's wording over as
  `page_text` in the chat context and no longer quotes it in the instruction, while the chatbot backend
  renders "the current page" from whatever `node_id` / `collection_id` resolves to and reads `page_text`
  **only where nothing resolved at all**. A saved content therefore reaches the model as the backend's
  own block — title, licence, thumbnail, compendium text — and how much of the wording that block carries
  is the backend's business, not the panel's. Watch for an answer that judges every criterion by what it
  calls the *zugänglicher Text*, or one that calls `get_url_text` on the source page; both say the text
  never arrived. See [CHATBOT-IO.md § Where the content's text stands](CHATBOT-IO.md#where-the-contents-text-stands).
- **`webextension-polyfill` throws when it is merely imported** outside an extension: its first
  statement is `if (!globalThis.chrome?.runtime?.id) throw`. Almost every service reaches it
  transitively — a DI token pulls in the class, the class pulls in `BrowserExtensionService`, and that
  imports the polyfill — so a unit test cannot avoid it by not touching the extension.
  `app-src/src/testing/extension-globals.setup.ts` therefore installs a `globalThis.browser` that
  already carries a `runtime.id`, which makes the polyfill skip its own wrapper construction and
  re-export that object unchanged. **That last part rests on the shape of `dist/browser-polyfill.js`
  rather than on a documented contract**; should a version drop the `else module.exports =
  globalThis.browser` branch, every spec would fail at import with *"This script should only be loaded
  in a browser extension."* The setup file also depends on Vitest running setup files before the test
  module is imported. See [TESTING.md § Unit tests](TESTING.md#unit-tests).
- **`@angular/build:unit-test` is marked `[EXPERIMENTAL]`** by its own builder description, and
  `providersFile`, `setupFiles` and the generated `angular:test-bed-init` are outside semver. The
  lockfile pins the builder; treat a minor bump as a change that needs `npm test` run before it is
  merged. Everything that moves lives in `app-src/src/testing/`, so a builder change touches one
  directory.
- **The panel's theme is handed to the edu-sharing bundle through a patched media query.** The
  bundle resolves its own theme from `(prefers-color-scheme: dark)` and from a preference in local
  storage, and it reads that preference **once**, as its theme service subscribes — the notification
  it listens on is internal to the bundle, so a value written from outside is only seen at bootstrap.
  `util/bundle-theme.ts` therefore writes the preference as `"auto"` and replaces `window.matchMedia`
  for colour-scheme queries alone, which is what makes the bundle follow a switch made while a form
  is open. Two consequences to know about: `prefers-color-scheme` reports the *panel's* theme to
  everything in the sidebar document, not the browser's — the panel's own resolution therefore goes
  through the reference `util/system-theme.ts` takes at module load, before the patch exists — and a
  bundle whose theme service stops asking the media query would silently fall back to light. What
  pins the current behaviour is `app-src/src/app/util/bundle-theme.spec.ts`; that the *bundle* still
  honours it is only verifiable by mounting one of its elements, see
  [TESTING.md](TESTING.md#load-the-extension).
- **The repository URL cannot be changed at runtime** without reloading the sidebar — the library
  freezes `rootUrl` at bootstrap and does not export its config classes.
- **The agent may only edit its own node for two hours.** Along the guest route the repository
  refuses later writes with a 403; the panel anticipates that and asks for a login instead. See
  [ARCHITECTURE.md § Saving a content](ARCHITECTURE.md#saving-a-content).

## The WLO canvas has no dark theme

`<metadata-agent-canvas>` is the one embedded element that cannot follow the panel's theme: 293 of
the colours in the `wlo/` bundle's own component styles are literals (`color: #1b1b1f`,
`background: #fcf8fd`) against only two dozen token references, so there is nothing to switch over,
and the element's attribute list offers only `background-color` (see
[WIDGET-REFERENZ.md](WIDGET-REFERENZ.md)). In a dark panel the two screens it takes over — *Metadaten
editieren* and *Vorschau* — therefore stay light, framed as a sheet laid on the panel
(`wlo-canvas.component.scss`).

Staying light takes work of its own, because both bundles run in the same document. The `edu/` bundle
declares its dark Material tokens on `body.isDarkTheme` — on the body, so everything inside it
inherits them, the canvas included, and its form fields, selects, chips and checkboxes would paint
white-on-light. `styles/_wlo-canvas-light.scss` puts exactly the colliding tokens back on the element
itself; the file's header records the derivation, which is recomputable after either bundle is
replaced. Dropdowns, menus and date pickers are rendered into the CDK's own overlay container, which
hangs off `<body>` rather than off the canvas, so those follow the panel's dark theme — intended, and
the one visible seam.

## Bundle size

`scripts/edu/` is 66 MB, of which 54 MB reach `dist/<target>/` (see
[BUILD.md § What goes into the package](BUILD.md#what-goes-into-the-package)). The two remaining
heavyweights are reachable and stay:

- **pdf.js** (`assets/pdf.*`, `assets/viewer*`, `assets/locale`, `assets/cmaps`,
  `assets/standard_fonts`, `assets/wasm`, ~21 MB). `chunk-OZPZMSZI.js` is the node renderer that
  picks `rs-module-pdf` by mime type; `edu/main.js` imports it eagerly and it sits behind
  `<edu-sharing-preview-sidebar>`, which the sidebar mounts in
  `preview-node/preview-node.component.html`. Previewing a PDF node fetches these. (`assets/locale`
  is 113 languages of pdf.js' `viewer.ftl`, not edu-sharing i18n.)
- **TinyMCE** (`assets/tinymce`, 13 MB). The core is bundled into `edu/scripts.js`; skins, themes and
  plugins are fetched from the folder as soon as an `<editor>` renders. Whether an MDS form has a
  rich-text widget is decided by the repository's metadata set, so this is a config question, not one
  the import graph can answer.
- The lazy route modules (107 chunks, 4.3 MB, `pdf-metadata-page` alone 2.4 MB) are dynamic imports
  of the bundle's router. The router runs inside the sidebar document, so whether it ever navigates
  depends on the URL — dropping them risks a 404 on a route chunk and needs a runtime check first.

## Lint output

**`web-ext lint` is error-free but noisy**: 0 errors, ~204 warnings, 1 notice. Every warning comes
from third-party libs inside the vendored bundles, not from this extension's own code —
`edu/assets/tinymce` (67), `edu/scripts.js` (17), `edu/assets/viewer*` (37), `edu/assets/pdf.worker*`
(19), `edu/assets/cordova` (7), `boerdi/boerdi-widget.js` (6), `edu/index.html` (5, the bundle's own
start page, which the extension never opens). The notice is `MISSING_DATA_COLLECTION_PERMISSIONS`:
AMO will require `browser_specific_settings.gecko.data_collection_permissions` in future. CI runs the
lint with `continue-on-error: true`, so warnings never block a build.
