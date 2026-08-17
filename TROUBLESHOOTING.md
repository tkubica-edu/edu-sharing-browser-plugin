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
  the repository URL is user-editable; expect stricter store review. `connect-src` also allows
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

- **`ngx-edu-sharing-api`** (10.0.10) is Angular-only and declares a peer dep of Angular >= 18, while
  the app runs Angular 21, so installing needs `legacy-peer-deps=true` (set in `app-src/.npmrc`). It
  is used for login, node create/update/read, and adding collection references; the last one goes
  through `CollectionServiceUnwrapped`, since the exported `CollectionService` wrapper is read-only.
- **The repository URL cannot be changed at runtime** without reloading the sidebar — the library
  freezes `rootUrl` at bootstrap and does not export its config classes.
- **The agent may only edit its own node for two hours.** Along the guest route the repository
  refuses later writes with a 403; the panel anticipates that and asks for a login instead. See
  [ARCHITECTURE.md § Saving a content](ARCHITECTURE.md#saving-a-content).

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
