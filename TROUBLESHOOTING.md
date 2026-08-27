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
- **A resolved node can hide the panel's own text.** The KI check hands the content's wording over as
  `page_text` in the chat context and no longer quotes it in the instruction, while the chatbot backend
  renders "the current page" from whatever `node_id` / `collection_id` resolves to and reads `page_text`
  **only where nothing resolved at all**. A saved content therefore reaches the model as the backend's
  own block — title, licence, thumbnail, compendium text — and how much of the wording that block carries
  is the backend's business, not the panel's. Watch for an answer that judges every criterion by what it
  calls the *zugänglicher Text*, or one that calls `get_url_text` on the source page; both say the text
  never arrived. See [CHATBOT-IO.md § Where the content's text stands](CHATBOT-IO.md#where-the-contents-text-stands).
- **The 3D conversion downloads ~40 MB before its first run.** `DepthModelService` fetches the
  Depth-Anything-V2-Small model (uint8, ~27 MB) and the onnxruntime-web WASM (~13 MB) and keeps both in
  Cache storage. A browser that hands out no cache for extension pages (a private window, cleared site
  data) costs that download again on the next run and nothing else — the failures are swallowed. The
  estimate itself runs single-threaded on the main thread, roughly one to three seconds for a 518 px
  input, during which the panel does not repaint; the wait is announced but not interruptible.
- **The 3D result is a relief, not a solid.** One picture carries no information about what is behind
  what it shows, so the mesh is a displaced surface: convincing near the angle the picture was taken
  from, and plainly flat-backed when turned right around. `ReliefViewer` limits the turn to about 80°
  for that reason. Depth Anything's values are inverse depth on an arbitrary scale — comparable within
  one picture, meaningless between two — so only their order carries into the geometry.
- **The 3D button is hidden where WebGL is missing.** `reliefViewerSupported()` requires WebGL plus
  `OES_element_index_uint`; a relief of any useful resolution exceeds the 65 536 vertices a draw call
  can address without it. The probe costs a WebGL context, so it is answered once and remembered.
- **A scanned PDF yields nothing.** `PdfTextService` reads the text layer a document carries; a scan
  carries none, and the reader answers with an empty text rather than an error — that is a property of
  the document. Every caller treats it as "no text here" and carries on with what the page or the node's
  metadata says. Recognising the characters in the image would need OCR, which the extension does not do.
- **The PDF reader ships no cMaps and no standard fonts.** `app-src/angular.json` copies only
  `pdf.worker.min.mjs`. Text encoded through one of pdf.js' predefined CMaps — CJK documents above all
  — can therefore come out garbled or empty, and pdf.js warns about the missing `standardFontDataUrl`
  on every document with a non-embedded standard font. The warning is harmless: those files carry glyph
  outlines for rendering, and nothing here renders a page. Adding the two would cost 1.6 MB and 800 kB.
- **The reader is a second copy of pdf.js.** `scripts/edu/` already ships one (see § Bundle size), but
  its worker only pairs with the API version it was built against, and that version moves whenever the
  bundle is refreshed — an unrelated overwrite would then break the reading. `pdfjs-dist` is a
  dependency of the app for that reason, versioned with it; the library is a lazy chunk (~430 kB) and
  the worker is 1.2 MB in the package.
- **Erschließen costs one `HEAD` per page.** A PDF is served under any address a server likes, so
  `BrowserExtensionService.pdfTextOfTab` asks for the content type where the address does not say and
  the page read as empty. The answer is remembered per address for the panel's lifetime. A server that
  refuses `HEAD` is taken at its silence — such a document goes unread.
- **The chat's local engine needs WebGPU, and the setting says so.** `LocalLlmService.supported()` is a
  `navigator.gpu` probe; without it the checkbox is disabled and the panel registers no seam. There is
  no CPU fallback on purpose — WASM inference answers a sentence in minutes, which is not a chat.
- **The first conversation on the device waits for a download of 1.5–2 GB.** The weights come from
  WebLLM's CDN once and live in Cache storage afterwards. Every later start still uploads them to the
  GPU, and the panel is torn down on every page change — so that upload is paid per page change.
- **The local model and the 3D conversion share one GPU.** Qwen2.5-3B claims about 2.9 GB and the depth
  model of `DepthModelService` wants its own; on an integrated GPU whichever loads second can fail.
- **The local engine has one tool.** It reads the open page (`get_url_text`) and nothing else: no WLO
  search, no collection instruction. A KI check on the device therefore judges against the criteria of
  the metadata set alone, while its tasks ask by name for tools that are not there yet.
- **A model that answers nothing usable, in two shapes seen so far.** Both are fixed and both are worth
  recognising again: a *second* system message fails the whole turn
  (`SystemMessageOrderError` — a runtime takes exactly one, at position 0), and a schema without a
  readable field leaves the person a placeholder instead of an answer (see
  [CHATBOT-IO.md § The structured formats](CHATBOT-IO.md#the-structured-formats)).
- **A chat that answers over the network although the setting says „on this device"** was refused at the
  seam. `[edu-sharing][boerdi] → setHostSeam, and the widget answers {…}` names the reason: no `local`
  in `engines` means the widget turned the model down, and a missing `setHostSeam` means the packaged
  bundle predates the seam (`scripts/boerdi/boerdi-widget.js` older than 2026-08-26).
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
