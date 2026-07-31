# Edu-Sharing — Browser-Extension

Cross-browser (Chrome, Edge, Firefox, Safari) WebExtension. It opens a resizable
sidebar whose start view is always the list of **Aktionen & Optionen** — only being logged out
(→ the login gate) or an explicitly loaded node (→ its Vorschau) opens something else. No option
opens itself from a page match: what the current page offers stays visible instead of being
decided for the user.

The app has no wizard and no fixed step order: every option is offered whenever its
preconditions hold. `ConditionsService` collects those facts (login, OnlyOffice page,
Edu-Sharing page, active node, editable metadata, edit mode) and each option in
`model/options.ts` decides its own visibility from that snapshot. The list order is the
registry's, with one context rule in `NavigationService.visibleOptions`: on an OnlyOffice page
*Inhalt suchen* leads the menu. The **status bar** shows the same facts as chips, so it is always
visible why an option appears or disappears — and it can drop the active content again. The
**back button** always returns to the menu.

The footer (`ActionBarService`) contributes the current view's next steps: *Erschließung
starten* on the analyze screen, *Speichern* on the metadata screen, and the choice between
*Metadaten editieren* / *Sammlung zuordnen* on the preview. Screens that own their own action
(the selectors, login, settings) get no footer.

The options:

- **Login** — the shared `es-login` gate; shown while logged out and reused inline by the
  screens that need a session.
- **Inhalt erschließen** — reads the active tab, calls `POST {apiUrl}/generate` through the
  background worker and advances to the metadata screen. Hidden on Edu-Sharing itself and on
  an insert host, where the intent is searching instead.
- **Metadaten anreichern** — only on an OnlyOffice page: the same erschließen flow, but the
  content comes from the **edited document** instead of the page. The sidebar asks the page-side
  plugin for the document content (`REQUEST_DOCUMENT_CONTENT` → `DOCUMENT_CONTENT`, correlated by
  `requestId` and bounded by a timeout, see `content/CLAUDE.md`), sends the answer's `markdown`
  through the background worker to `POST {apiUrl}/generate` and opens the result in the metadata
  editor. The answer's `document` makes the edited document the **active node**, so **Speichern**
  writes the enriched metadata onto that node (`editNodeMetadata`) rather than creating a new one
  in the inbox — the node's name is kept, so the document is never renamed.
- **Metadaten editieren** — loads the metadata into `edu-sharing-mds-editor-wrapper`. Saving
  creates a `ccm:io` node in the **inbox** the first time (`NodeService.createChild`) and
  updates it in place thereafter (`editNodeMetadata`), then advances to the preview. Available
  for an active node or a fresh result that was never saved. Extracted fields and the raw JSON
  stay in collapsibles.
- **Vorschau** — the node's name and link plus a live `edu-sharing-preview-sidebar`. Its `node`
  input takes the full hydrated node, so the node is (re)loaded after a save.
- **Einsortieren in Sammlungen** — `edu-sharing-nodes-selector` as a collection picker. Its
  contract is callback-based (`option.optionConfig.onNodesChoosen`), so the component owns the
  callback and the add itself runs in the sidebar via ngx-edu-sharing-api's
  `CollectionServiceUnwrapped.addToCollection` (the generated `CollectionV1Service`, exported
  under that alias since 10.0.2 — the `CollectionService` wrapper is read-only).
- **Neues OnlyOffice-Dokument** — mounts `edu-sharing-add-with-connector`, which opens the
  OnlyOffice create dialog; the new node is hydrated into the flow and opens in the preview.
- **Inhalt suchen** — only on an insert host (URL matches `/src/tools/onlyoffice`): the same
  selector in search mode, posting the chosen nodes to the host page.
- **Verlauf** — the **saved nodes**, newest first. An entry is recorded only when a node is
  actually saved, so every row carries a `nodeId` (legacy pre-node entries are dropped on load,
  and re-saving a node moves its row to the top instead of duplicating). *In Vorschau öffnen*
  fetches the live node by id (`CurationService.openFromHistory` → `RepositoryNodeService.get`)
  and opens it; if there is unsaved work the shell confirms first, and a failed fetch is
  surfaced via an alert.
- **Einstellungen** — the Repository-URL (used for login and every embedded element).
- **WLO Metadaten-Agent** — only when the repository config enables it, see below.

A node double-clicked in the OnlyOffice plugin arrives as a `PREVIEW_NODE` message (relayed by
`content/panel-host.js`, or replayed from storage if the sidebar was closed) and opens in the
preview; while logged out it is held until the login succeeds.

Authentication against an edu-sharing repository uses the official
[`ngx-edu-sharing-api`](https://www.npmjs.com/package/ngx-edu-sharing-api) library.
The repository session is shared, so signing in on either primary tab unblocks both.

**Session restore.** Login is cookie-based: Basic auth is sent only on the login
request, the server sets a session cookie, and every later request carries it
(`withCredentials`). That cookie outlives sidebar reloads, so on startup `AuthService.init`
revalidates it (`observeLoginInfo()`, 8s timeout) and, if a valid non-guest session is
still active, restores the logged-in state before the shell lands on a view — you don't
re-enter credentials when reopening the panel or switching pages, and **no password is
stored**. While it checks, the status bar shows "Anmeldung wird geprüft…". If the cookie
is gone (browser restart, explicit logout, or Safari ITP blocking the third-party cookie)
it resolves to guest and the login gate appears.

## Direct web-component embedding

The pre-built edu-sharing bundle lives in `scripts/edu/` (packaged as `edu/` in the built
extension). It is built from the edu-sharing frontend (`npm run build:app-as-component`
→ `dist/web-components/app/`) and registers every element used here:
`edu-sharing-mds-editor-wrapper`, `edu-sharing-preview-sidebar`,
`edu-sharing-nodes-selector`, `edu-sharing-add-with-connector`. A second bundle,
`scripts/wlo/` → `wlo/`, provides the optional `metadata-agent-canvas` (see below).

The elements are used as **real custom elements in the sidebar document — no iframes**.
`WebComponentBundleService` owns that: it injects each bundle's stylesheet and scripts once,
sets `window.__env.EDU_SHARING_API_URL` before the edu bundle boots (its HttpClient freezes
the value), and loads a bundle's `polyfills` (zone.js) only if no other bundle brought a Zone
already. Components declare what they need as a field:

```ts
protected readonly bundle = loadWebComponentBundle('edu', 'edu-sharing-preview-sidebar');
```

and gate the tag on `bundle.ready()` / show `bundle.error()`. Pass the tag when the element
must be defined before it renders; omit it when the element is created imperatively or must
carry its inputs as it upgrades (the nodes selector reads `option.optionConfig` on connect,
so `NodesSelectorComponent` renders the tag immediately and only reports load errors).

`MdsEditorComponent` is the one element created imperatively: the wrapper throws in its
`ngOnInit` unless `embedded`/`currentValues` are already set, and Angular applies template
bindings only *after* connect — so the element is built with every input assigned, then
appended. In embedded mode it renders no buttons of its own; the footer's save action calls
`commit()`, and edited values arrive via its `currentValuesChange` event.

The elements' own repository calls (MDS definition, value rendering) reuse the login session
cookie when the user is logged in; as guest they rely on public access.

## The optional WLO metadata editor

`AdditionalWebComponentService` watches the repository config for the boolean variable
**`additionalWebComponent`**. While it is enabled, `WloCanvasComponent` —
`<metadata-agent-canvas>` from the packaged `wlo/` bundle — takes over two screens:

- **Metadaten editieren** (`mode="edit"`) instead of the edu-sharing MDS editor,
- **Vorschau** (`mode="detail"`) instead of `edu-sharing-preview-sidebar`, showing the saved
  properties read-only. Saving still lands there, so the preview follows the edit as before.

The per-mode settings are the two presets the bundle's own
`examples/canvas-parameter-demo.html` documents — "Plugin" and "Detail (readonly)" — kept
verbatim in `CONFIGS` so they stay comparable with that reference.

Nothing else changes: *Inhalt erschließen* still runs the metadata agent through the background
worker, its result is loaded into the editor, and saving still creates or updates the repository
node and records it in the Verlauf.

Both editors implement the same `MetadataEditor` contract (`ready` + `commit()`), so the footer
owns "Speichern" either way and the metadata screen only picks which one to render. In
`mode="detail"` the canvas is read-only and nothing is committed.

Its save/upload buttons stay hidden in both modes (the footer saves) and page mode is off
(*Inhalt erschließen* is the app's own extraction path). Seeding is direct: its `importJsonData`
reads `metadata || <the payload>` plus `metadataset` / `_origins` / `_source_text` /
`preview_image_url`, which is exactly the agent payload shape, so an analysis result and a node's
stored properties both load as-is. Edits arrive continuously via `metadataChange`; on save the
namespaced field values are kept and the envelope is dropped, since it is not node metadata.

The bundle reads `window.__ENV.agentUrl` at bootstrap (falling back to its own hardcoded
default), so `WebComponentBundleService` publishes the configured `APP_CONFIG.apiUrl` there
before the scripts run — mirroring `window.__env.EDU_SHARING_API_URL` for the edu bundle.
`wlo/`'s file names are content-hashed, so its entry points are read from its own `index.html`.

## Architecture

- **Sidebar UI** (`app-src/`) — an Angular 21 standalone app, built to `sidebar/`.
- **Panel host** (`content/panel-host.js`) — injected on toolbar click; mounts the
  sidebar as a docked, resizable `<iframe>` (drag the left edge; width persists).
  This is the cross-browser replacement for the Chromium-only side-panel API.
- **Background** (`background/background.js` via `sw.js`) — toggles the panel,
  extracts the active tab's content (`content/content.js`), and **proxies the
  `/generate` call** so it runs from the service worker (portable across browsers,
  avoids page-CSP/CORS pitfalls).
- **Auth** runs inside the Angular app (the library owns its HttpClient); it calls
  `GET {repo}/edu-sharing/rest/authentication/v1/validateSession` with Basic auth.

### Network legs & CORS
| Leg | Where it runs | Why |
|-----|---------------|-----|
| `POST /generate` (Metadata-Agent API) | background service worker | background fetch is gated by `host_permissions`, not CORS/page-CSP — portable everywhere (`analyze.run` for a tab, `analyze.text` for the OnlyOffice document's markdown) |
| Page content extraction | `scripting.executeScript` (background) | no cross-origin fetch |
| Repository login | Angular `HttpClient` (library) | the library owns the call; relies on `host_permissions` bypassing CORS on Chrome/Edge/Firefox |

## Build

```bash
cd edu-sharing-extension
npm install            # build harness deps (archiver, web-ext, polyfill)
npm run install:app    # Angular app deps (app-src/)
npm run build          # ng build + assemble dist/{chrome,firefox,safari}
```

Useful variants:
- `npm run build:chrome` / `:firefox` / `:safari` — single target.
- `npm run build:no-ng` — reuse the last Angular build (skip `ng build`).
- `npm run lint:firefox` — `web-ext lint` on the Firefox build.

Output: `dist/chrome/`, `dist/firefox/`, `dist/safari/` (+ `.zip` for chrome/firefox).
Edge uses the **Chrome** build (Chromium — no separate target).

## Load & test

**Chrome / Edge**: `chrome://extensions` → enable *Developer mode* → *Load unpacked*
→ select `dist/chrome`. Click the toolbar icon on any normal `https://` page.

**Firefox**: `npm run start:firefox` (or `about:debugging` → *Load Temporary Add-on*
→ `dist/firefox/manifest.json`).

**Safari** (macOS + Xcode):
```bash
xcrun safari-web-extension-converter dist/safari
```
Open the generated Xcode project and Run.

### Manual test checklist
1. Toolbar click → the sidebar docks on the right; drag its left edge to resize; the ✕ button
   closes it. The menu lists the options visible for the current page, and the status bar shows
   the matching chips.
2. **Einstellungen**: the Repository-URL defaults to
   `https://repository.staging.openeduhub.net/edu-sharing` and is required. Changing it shows an
   *Übernehmen* button that reloads the sidebar so the library re-initializes against the new
   repository (a dot marks the option until applied).
3. **Login**: required for everything except *Einstellungen*. Enter staging credentials → the
   status bar flips to "Angemeldet: …" and the login option disappears while the rest appear.
   If the repository URL was changed, login is blocked until it is applied in *Einstellungen*.
4. **Erschließen + speichern**: *Inhalt erschließen* on a content page → the metadata screen
   shows `fields_extracted / fields_total` and loads the MDS editor with the generated
   metadata. Edit, then the footer's **Speichern** → a node is created in your inbox and the
   preview opens. The status bar gains an "Aktiver Inhalt" chip, which also clears it again.
5. **Metadaten anreichern** (OnlyOffice): open a document in the OnlyOffice editor with the
   edu-sharing plugin active, open the panel → the option appears and names the detected document.
   The footer's **Metadaten anreichern** reads the document and lands on the metadata screen with
   the generated metadata, the status bar showing the document as *Aktiver Inhalt*. **Speichern**
   must update **that** node — check in the repository that the document's metadata changed, that
   its name/extension is unchanged, and that no new node appeared in the inbox. With the page-side
   plugin switched off (*Plugins im Hintergrund*) the screen must report the timeout instead of
   hanging.
6. **Vorschau → Sammlungen**: from the preview, *Sammlung zuordnen* → pick a collection and
   confirm with *In Sammlung einfügen*; the screen lists what was added.
7. **Verlauf**: every *saved* node is listed (nothing is recorded until you save); entries
   expand to show their fields and offer *In Vorschau öffnen*, which reloads the node from the
   repository; *Leeren* clears the list.
8. If an embedded element stays blank, check the sidebar frame's console for CSP or
   repository-CORS errors — the elements run in this document, so their errors show up there.

## Known issues / caveats
- **Safari**: the `host_permissions` CORS bypass for extension pages is unreliable,
  and ITP may block the repository session cookie in the injected-panel context.
  Guest Erschließung (via the background worker) is unaffected; logged-in auth needs
  verification on Safari and may require a background auth fallback.
- **`ngx-edu-sharing-api`** (10.0.10) is Angular-only and declares a peer dep of Angular
  >= 18, while the app runs Angular 21, so installing needs `legacy-peer-deps=true` (set in
  `app-src/.npmrc`). It is used for login, node create/update/read, and adding collection
  references; the last one goes through `CollectionServiceUnwrapped`, since the exported
  `CollectionService` wrapper is read-only.
- **Broad permissions** (`host_permissions: https://*/*`, `connect-src https:`) are
  required because the repository URL is user-editable; expect stricter store review.
- The repository URL cannot be changed at runtime without reloading the sidebar —
  the library freezes `rootUrl` at bootstrap and does not export its config classes.
- **MDS editor rendering needs verification in a real browser.** Two things must hold:
  (1) the vendored bundle boots under the extension CSP (`script-src 'self'` — its core has no
  `eval`; only unused PDF/Monaco/Cordova *assets* do), and (2) the editor can fetch the MDS
  definition from the repository (CORS/auth). Load the unpacked extension and run an
  Erschließung to confirm; the elements run in the sidebar document, so any failure shows up
  in the sidebar frame's console.
- **Bundle size**: `scripts/edu/` is ~22 MB (unpacked target ~77 MB) because
  it includes unused lazy assets (`assets/monaco`, `assets/pdf.*`, `assets/cordova`)
  and the `pdf-metadata-page` chunk. These are runtime-fetched only, so pruning them
  would slim the package and clear the `FILE_TOO_LARGE` web-ext lint error — do this
  once the editor is confirmed working. The remaining `web-ext lint` findings
  (`UNSAFE_VAR_ASSIGNMENT` innerHTML) originate inside the vendored bundle's
  third-party libs, not this extension's own code.
