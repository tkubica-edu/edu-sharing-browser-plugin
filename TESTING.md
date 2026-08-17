# Load & test

- [Load the extension](#load-the-extension)
- [Debug mode (OnlyOffice without OnlyOffice)](#debug-mode-onlyoffice-without-onlyoffice)
- [Manual test checklist](#manual-test-checklist)
- [Where errors show up](#where-errors-show-up)

Building first: [BUILD.md](BUILD.md).

---

## Load the extension

**Chrome / Edge**: `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select
`dist/chrome`. Click the toolbar icon on any normal `https://` page.

**Firefox**: `npm run start:firefox` (or `about:debugging` → *Load Temporary Add-on* →
`dist/firefox/manifest.json`).

**Safari** (macOS + Xcode):

```bash
xcrun safari-web-extension-converter dist/safari
```

Open the generated Xcode project and Run.

A rebuilt bundle or manifest needs an explicit *Reload* in the browser's extension page — neither
browser picks up a changed package on its own.

## Debug mode (OnlyOffice without OnlyOffice)

*Einstellungen* → **Debug-Modus: OnlyOffice-Events simulieren**. With it on, the sidebar behaves as
if it ran on an OnlyOffice page with the edu-sharing plugin active:

- every page counts as an insert host, so *Metadaten anreichern*, *Passende Inhalte finden* and
  *Inhalt suchen* are reachable anywhere;
- each `REQUEST_DOCUMENT_CONTENT` / `REQUEST_DOCUMENT_INFO` is answered immediately with a
  hard-coded test document (`app-src/src/app/services/debug.service.ts`) instead of being broadcast
  to a page that would never reply;
- `PREVIEW_NODE` has no request to answer, so the settings offer a button that fires one;
- the *Einstellungen* screen marks the state, and every simulated event is logged as
  `[edu-sharing][debug]`.

The answers are injected through the **real** inbound path (a window message carrying the plugin's
source marker), so `requestId` correlation, identity handling and node hydration run exactly as in
production. Only the inbound direction is faked — `INSERT_NODE` still goes to the host page as usual.

**Test-Node-ID** is what the simulated document reports as the edited node. The default is a fake id
(the repository load fails silently and the UI falls back to that id); put a real node id in to
exercise the whole flow including *Speichern*. The flag is persisted in `storage.local`, so it
survives reloads inside the extension — in a plain `ng serve` there is no extension storage and it
resets per session.

## Manual test checklist

1. **Panel.** Toolbar click → the sidebar docks on the right; drag its left edge to resize; the ✕
   button closes it — and the page must take the freed width back immediately (no empty strip), also
   after a later window resize and after closing straight out of a drag. The start view is the menu,
   which lists the options visible for the current page (on an OnlyOffice page *Inhalt suchen* first,
   and nothing opens on its own), and the topbar carries the *Verlauf* / *Einstellungen* icons.
2. **Einstellungen** (topbar icon, reachable while logged out): the Repository-URL defaults to
   `https://repository.staging.openeduhub.net/edu-sharing` and is required. Changing it shows an
   *Übernehmen* button that reloads the sidebar so the library re-initializes against the new
   repository (a dot marks the icon until applied).
3. **Login**: required for everything except *Einstellungen*. Enter staging credentials → the session
   bar flips to "Angemeldet: …" and the login option disappears while the rest appear. If the
   repository URL was changed, login is blocked until it is applied in *Einstellungen*.
4. **Erschließen + speichern**: *Inhalt erschließen* on a content page → the metadata screen shows
   `fields_extracted / fields_total` and loads the MDS editor with the generated metadata. Edit, then
   the footer's **Speichern** → a node is created in your inbox and the preview opens, and the flow's
   steps become reachable for that content.
5. **Metadaten anreichern** (OnlyOffice): open a document in the OnlyOffice editor with the
   edu-sharing plugin active, open the panel → the option appears and names the detected document.
   The footer's **Metadaten anreichern** reads the document and lands on the metadata screen with the
   generated metadata, the menu naming the document under *Inhalt erkannt*. **Speichern** must update
   **that** node — check in the repository that the document's metadata changed, that its
   name/extension is unchanged, and that no new node appeared in the inbox. With the page-side plugin
   switched off (*Plugins im Hintergrund*) the screen must report the timeout instead of hanging.
6. **Vorschau → Sammlungen**: from the preview, *Sammlung zuordnen* → pick a collection and confirm
   with *In Sammlung einfügen*; the screen lists what was added.
7. **Verlauf**: every *saved* node is listed (nothing is recorded until you save); entries expand to
   show their fields and offer *In Vorschau öffnen*, which reloads the node from the repository;
   *Leeren* clears the list.

## Where errors show up

The embedded elements run in the **sidebar document**, not in a frame of their own, so their failures
appear in the sidebar frame's console — select that frame in DevTools. If an embedded element stays
blank, look there for CSP or repository-CORS errors first.

Every log the extension writes itself carries the prefix `[edu-sharing][<station>]`. The background
worker logs to the extension's own console (`chrome://extensions` → *service worker*,
`about:debugging` → *Inspect*).
