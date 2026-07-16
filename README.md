# Edu-Sharing — Browser-Extension

Cross-browser (Chrome, Edge, Firefox, Safari) WebExtension. It opens a resizable
sidebar with three tabs:

- **Erschließung** — a 4-step wizard (sub-tabs you can jump between once unlocked):
  1. *Erschließen* — login is **required**, then *Erschließung starten* reads the
     current tab and calls `POST {apiUrl}/generate` (re-running discards the prior
     created node).
  2. *Metadaten* — loads the result into the **`edu-sharing-mds-editor`** (Cancel
     hidden). **Speichern** creates a new `ccm:io` node in the **INBOX** the first
     time (`NodeService.createChild`) or updates it thereafter (`editNodeMetadata`);
     re-entering the step edits the node's stored metadata. Raw fields/JSON stay in
     collapsibles.
  3. *Preview node* — the created node's name + link (unlocked once a node exists).
  4. *Zuordnen* — placeholder for collection/editorial assignment (further web
     components to follow).
- **Suche nach Inhalten** — a main tab shown only when the active tab URL matches
  `/src/tools/onlyoffice` (placeholder content for now).
- **Verlauf** — lists previously processed pages (expandable).
- **Einstellungen** — the Repository-URL (used for login and the MDS editor).
- **Verlauf** — previously processed pages.

Authentication against an edu-sharing repository uses the official
[`ngx-edu-sharing-api`](https://www.npmjs.com/package/ngx-edu-sharing-api) library.

## The MDS editor (edu-sharing web component)

The pre-built edu-sharing web-component bundle lives in `scripts/webcomponent/`
(registers `edu-sharing-mds-editor`, among others). Because that bundle ships its
own full Angular runtime (zone.js + DI), it cannot share a document with this
sidebar's Angular app. So it is hosted in a **same-origin iframe**:

- `webcomponent-host/{mds-editor.html, mds-env.js, mds-bridge.js}` are overlaid onto
  the bundle at build time (→ `dist/<t>/webcomponent/`). `mds-env.js` sets
  `window.__env.EDU_SHARING_API_URL` from the iframe's `?api=` param (an inline
  script would violate the CSP); `mds-bridge.js` creates `<edu-sharing-mds-editor>`
  and relays `save`/`valuesChange`/`cancel` back to the sidebar via `postMessage`.
- The sidebar's `MdsEditorComponent` embeds that iframe, and on the bridge's `ready`
  handshake posts the generated metadata (`init` → element `.metadata`), plus
  `groupId='io'` and `editorMode='form'`.

The editor's own repository calls (MDS definition, value rendering) reuse the login
session cookie when the user is logged in; as guest it relies on public access.

> The metadata web component is intentionally **not** embedded — the sidebar only
> renders the `/generate` output. A separate web component will consume it later.

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
| `POST /generate` (Metadata-Agent API) | background service worker | background fetch is gated by `host_permissions`, not CORS/page-CSP — portable everywhere |
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
1. Toolbar click → sidebar docks on the right; drag its left edge to resize; the ✕
   button closes it. Three tabs: Erschließung, Verlauf, Einstellungen.
2. **Einstellungen**: Repository URL defaults to
   `https://repository.staging.openeduhub.net/edu-sharing` and is required. Changing
   it shows an *Übernehmen* button that reloads the sidebar so the library
   re-initializes against the new repository (a dot marks the tab until applied).
3. **Login** (Erschließung tab): required — *Erschließung starten* is disabled until
   logged in. Enter staging credentials → status flips to logged in. If the repo URL
   was changed, login is blocked until it is applied in Einstellungen.
4. **Analyze + save**: click *Erschließung starten* on a content page → shows
   `fields_extracted / fields_total` and loads the `edu-sharing-mds-editor` with the
   generated metadata. Edit, then **Speichern** → a node is created in your INBOX and
   its link appears. *If the editor iframe stays blank*, open its devtools
   (right-click → “This Frame”) and check for CSP or repository-CORS errors.
5. **Verlauf**: each run is appended; entries expand to show fields; *Leeren* clears.

## Known issues / caveats
- **Safari**: the `host_permissions` CORS bypass for extension pages is unreliable,
  and ITP may block the repository session cookie in the injected-iframe context.
  Guest Erschließung (via the background worker) is unaffected; logged-in auth needs
  verification on Safari and may require a background auth fallback.
- **`ngx-edu-sharing-api`** is Angular-only and declares peer deps of Angular 14–18,
  while the app runs Angular 21. Its compiled output links fine under the newer
  compiler, but the peer mismatch requires `legacy-peer-deps=true` (set in
  `app-src/.npmrc`). Its build (mid-2025) also means it may lag future Angular;
  it is also inactively maintained. It is used purely for the login call.
- **Broad permissions** (`host_permissions: https://*/*`, `connect-src https:`) are
  required because the repository URL is user-editable; expect stricter store review.
- The repository URL cannot be changed at runtime without reloading the sidebar —
  the library freezes `rootUrl` at bootstrap and does not export its config classes.
- **MDS editor rendering is not yet verified in a real browser.** Two things must
  hold: (1) the vendored bundle boots under the extension CSP (`script-src 'self'` —
  its core has no `eval`; only unused PDF/Monaco/Cordova *assets* do), and (2) the
  editor can fetch the MDS definition from the repository (CORS/auth). Load the
  unpacked extension and run an Erschließung to confirm; if the iframe is blank,
  inspect that frame's console.
- **Bundle size**: `scripts/webcomponent/` is ~22 MB (unpacked target ~77 MB) because
  it includes unused lazy assets (`assets/monaco`, `assets/pdf.*`, `assets/cordova`)
  and the `pdf-metadata-page` chunk. These are runtime-fetched only, so pruning them
  would slim the package and clear the `FILE_TOO_LARGE` web-ext lint error — do this
  once the editor is confirmed working. The remaining `web-ext lint` findings
  (`UNSAFE_VAR_ASSIGNMENT` innerHTML) originate inside the vendored bundle's
  third-party libs, not this extension's own code.
