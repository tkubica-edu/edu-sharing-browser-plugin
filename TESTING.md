# Load & test

- [Load the extension](#load-the-extension)
- [Dev mode (faked KI answers)](#dev-mode-faked-ki-answers)
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

## Dev mode (faked KI answers)

*Einstellungen* → **Dev-Modus: KI-Antworten faken** (`DevModeService`). The slow, paid services answer
from fixtures instead of being asked: the metadata agent's `/health`, `/generate` (in the background
worker, `background/dev-fixtures.js`) and `/extract-field`, and ContentJudge's `/health` and
`/evaluate`. The assistant's own chat is **not** faked — a check it runs is the thing under test.

While the mode is on, a page is also never recognised as one that has been erschlossen before: the
history and the repository's URL lookup (`duplicateNodes`) are both skipped
(`PageRecognitionService`), so *Inhalt erschließen* stays offered for a page a test run already put
into the repository. Switching the mode on also lets go of a content that was recognised before it was
switched on — otherwise that finding would go on standing for the page. Neither applies on an insert
host, where the announced document stands for the page rather than a lookup, and neither throws away
unsaved work.

Three further settings appear while the mode is on, and hold only while it is:

- **Gefakter Inhalt** — which erschlossener Inhalt `/generate` answers with. `dresden` is a sound
  content; `optik` carries factual errors in its text on purpose, so a quality check has something to
  find. The payloads live in `background/dev-fixtures.js` (the worker answers that call); the select's
  ids come from `GENERATE_FIXTURES` in `dev-mode.service.ts` and have to stay in step with that
  object's keys.
- **Test-Sammlungs-ID** — the collection every step that works off one is to work off. It takes three
  places at once, so no step has to be walked for it:
  - it joins `CurationService.filedCollections`, which is what the KI check reads its collection from;
  - it *is* the „Empfohlene Sammlung" — `CollectionRecommendationService.recommend` answers with it
    and the topic assistant is not asked at all, so the proposal is the collection under test rather
    than whatever the keywords of the moment lead to;
  - where it belongs to none of the configured editorial groups, the forwarding step shows it under
    the first of them (`EditorialGroupsService.hostGroupForTest`) — a test collection sits wherever it
    sits, and a proposal outside every group would otherwise be dropped unseen.

  The content is never put into it: it is the subject a check works off, not a filing decision, so it
  is kept out of what a save writes.
- **Nichts ins Repositorium schreiben** — every step's *Weiter* leads on without writing
  (`CurationService.leaveUnwritten`). No node is created and none is updated, so a step behind the
  first save can be repeated without leaving a node behind each time. Off by default, because the
  saving is itself worth testing.

### Reaching „Individuelle Qualitätsprüfung mit KI" quickly

1. Switch the dev mode on, put a real collection id into **Test-Sammlungs-ID**, tick **Nichts ins
   Repositorium schreiben**.
2. *Inhalt erschließen* on any page → the faked run answers at once.
3. *Weiter* through Vorschau and whichever filing steps apply — none of them writes now.
4. *Prüfprozess auswählen* → **Individuelle Qualitätsprüfung mit KI** → the dialogue runs against the
   collection from the settings.

The check needs no node of its own (the section asks for `hasEditableMetadata`, which the faked run
satisfies), so the run ends on the menu rather than the Inhaltsübersicht — that step is about a node,
and this run wrote none. To test the writing instead, untick the checkbox and walk the same path.

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
