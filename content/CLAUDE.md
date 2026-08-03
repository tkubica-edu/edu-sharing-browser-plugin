# Event Documentation — Browser Extension ↔ Host Application

This file documents every event/message exchanged between the extension's sidebar and the
**host application** the extension is embedded in, in **both directions**: **which** events
exist, **when/how/where** they fire, and **what data structure** they carry.

The public events are deliberately **application-agnostic**: the extension does not know which
page it is embedded in. Any web application can integrate by using the contracts below.
OnlyOffice is just **one concrete example** — the same works for H5P editors, CMS editors,
custom web apps, etc.

These public events cross the extension ↔ host boundary:

| Direction | Event | Meaning |
|-----------|-------|---------|
| **Extension → host** | `INSERT_NODE` | user picked node(s) in the selector ("Gewählten Inhalt kopieren") |
| **Extension → host** | `REQUEST_DOCUMENT_CONTENT` | extension asks for the content of the document the host has open |
| **Extension → host** | `REQUEST_DOCUMENT_INFO` | extension asks for that document's identity only |
| **Host → extension** | `PREVIEW_NODE` | host asks the extension to preview/edit a node (e.g. user double-clicked an inserted object) |
| **Host → extension** | `DOCUMENT_CONTENT` | the answer to `REQUEST_DOCUMENT_CONTENT` (also fired unsolicited by the plugin's toolbar button) |
| **Host → extension** | `DOCUMENT_INFO` | the answer to `REQUEST_DOCUMENT_INFO` (also announced once on plugin startup) |

`content/panel-host.js` (the content script on the host page) is the relay hub for both
directions. It broadcasts `INSERT_NODE` and the two `REQUEST_*` events into all frames, and
relays every inbound envelope into the sidebar iframe.

---

## Frame / Context Map

```
Host page (any web application) ── content script: panel-host.js   (relay hub, both directions)
 ├─ Sidebar iframe (sidebar/index.html, extension origin) ── Angular app
 │    (app.component.ts, ext.service.ts, search.component.ts + <edu-sharing-nodes-selector>)
 └─ (optional) arbitrarily nested, possibly cross-origin iframes
      └─ integrating application  ── sends PREVIEW_NODE / listens for INSERT_NODE
                                      (e.g. the OnlyOffice edu-sharing plugin)
```

Note: since the earlier iframe/bridge design, the selector (`<edu-sharing-nodes-selector>`) is
mounted as a **real custom element directly in the sidebar document** (loaded by
`EduBundleService`) — there is no longer a separate nodes-selector iframe or postMessage bridge.

The integrating app may sit **on the top page itself** or in an **arbitrarily nested,
cross-origin iframe**. That is why `INSERT_NODE` is broadcast into *all* frames, and why
`PREVIEW_NODE` is expected on `window.top`. Each level is a separate JS context with its own
console. Debug logs carry the prefix `[edu-sharing][<station>]`.

---

## Direction 1 — Extension → Host: `INSERT_NODE`

Fired when the user selects content in the sidebar and clicks **"Gewählten Inhalt kopieren"**.

### Internal chain
| # | From → To | Transport | Identifier | Payload |
|---|-----------|-----------|-----------|---------|
| 1 | `<edu-sharing-nodes-selector>` → `search.component.ts` | `option.optionConfig.onNodesChoosen` callback (same JS context) | — | `{nodes, connectorId, window}` |
| 2 | `search.component.ts` → host top | `window.parent.postMessage` (via `ext.insertNodes`) | `{type:'edusharing-insert-node'}` | `{nodes}` |
| 3 | **`panel-host.js` → all frames** | `postMessage` + `CustomEvent` | **`INSERT_NODE` envelope** | `{nodes}` |

- There is **no DOM "copy" event** on the element; the only hook is the
  `option.optionConfig.onNodesChoosen` callback, set in `search.component.ts`. Precondition:
  `parent` is not set (otherwise the selector copies internally and fires nothing).
- Step 3 broadcasts into every frame via `broadcastToFrames(window.top, envelope)`
  (recursive `frame.postMessage(envelope, '*')`), because the receiver may be in a nested,
  cross-origin iframe. A `CustomEvent` fallback is also dispatched (same-frame only).

### Public contract (what the host listens for)
```js
const SOURCE = "edu-sharing-browser-plugin";   // marker for extension → host messages

window.addEventListener("message", (e) => {
  const env = e.data;
  if (!env || env.source !== SOURCE) return;    // foreign message → silently ignore
  if (env.event === "INSERT_NODE") {
    const nodes = env.data.nodes;               // array of full node objects (see below)
    // ... insert into your application
  }
});
```
Envelope: `{ source: "edu-sharing-browser-plugin", event: "INSERT_NODE", data: { nodes: Node[] } }`.

---

## Direction 2 — Host → Extension: `PREVIEW_NODE`

Fired by the host application to ask the extension to show a node (e.g. the user double-clicked
an inserted edu-sharing object in the editor). The extension loads it into the Erschließung
wizard — Vorschau (preview) with editable Metadaten — the same view as selecting a Verlauf entry.

### What the host sends
```js
window.top.postMessage({
  source: "edu-sharing-onlyoffice-plugin",   // NOTE: different marker than the extension→host source
  event:  "PREVIEW_NODE",
  data:   { id, url, nodeWidth, nodeHeight, nodeTitle, nodeCaption, nodePermaLink, nodeMimeType, nodeRepo }
}, "*");
```
All `data` values are strings. **The extension only requires `data.id`** — it hydrates the full
node from the configured repository (`UploadService.getNode(id)`) and renders the preview via the
bundle, authenticated by the repository **session cookie**. The other fields (url, dimensions,
mimetype…) are currently ignored. No ticket needs to be sent (the spec's `?ticket=` note only
applies if the raw `data.url` image is loaded manually, which the extension does not do).

### Internal chain
| # | From → To | Transport | Identifier | Payload |
|---|-----------|-----------|-----------|---------|
| 1 | integrating app → host top | `window.top.postMessage` | `{source:'edu-sharing-onlyoffice-plugin', event:'PREVIEW_NODE'}` | `{id, …}` |
| 2 | `panel-host.js` → sidebar iframe | `iframe.contentWindow.postMessage` (+ buffer in memory & `storage.local`) | same envelope | `{id, …}` |
| 3 | sidebar `app.component.ts` | `@HostListener('window:message')`, filter `data.source` | — | `{id, …}` |
| 4 | `CurationService.loadFromNode(id)` → `UploadService.getNode(id)` → wizard step 3 + switch to Erschließung tab | — | — | full `Node` |

- **Filter by `data.source`, not `event.origin`** — the sender is a cross-origin frame, so the
  relayed `event.origin` is the host page origin, not the extension origin.
- **Buffering** (panel closed/booting): `panel-host.js` keeps the last inbound message in memory
  and persists it to `storage.local` (`eduSharingPendingPreview`). The sidebar, on boot, posts
  `edusharing-sidebar-ready` (→ panel-host replays the buffered message) and also reads+clears the
  persisted entry. `app.component.ts` dedupes duplicate deliveries (storage replay + live relay).
- **Limitation:** if the panel was **never opened** (no content script injected) when the host
  fired `PREVIEW_NODE`, there is no relay running and the event is lost. Capturing that would
  require a persistent `all_frames` content script.
- **Login:** hydration needs a logged-in session. If logged out on receive, the sidebar shows the
  login gate and loads the node automatically once the user logs in.

---

## Direction 3 — Request/response: the open document's content

Powers **"Metadaten anreichern"**: on an OnlyOffice page the extension enriches the *edited
document* instead of the page. It asks the host for the document's content and sends the
`markdown` rendering to the metadata agent (`POST /generate`, text mode), then opens the result in
the metadata editor. The `document` identity makes the edited document the **active node**, so
saving writes the enriched metadata **onto that node** (`editNodeMetadata`) instead of creating a
new one in the inbox.

Unlike the two directions above this is a **correlated pair**: every request carries a
`requestId`, which the host mirrors into its answer, so parallel requests stay distinguishable.

### What the extension sends
```js
// broadcast into every frame by panel-host.js
{ source: "edu-sharing-browser-plugin", event: "REQUEST_DOCUMENT_CONTENT", data: { requestId } }
{ source: "edu-sharing-browser-plugin", event: "REQUEST_DOCUMENT_INFO",    data: { requestId } }
```

### What the host answers
```js
{ source: "edu-sharing-onlyoffice-plugin", event: "DOCUMENT_CONTENT",
  data: { trigger, requestId, editorType, title, text, markdown, elements, html, documentJson, … },
  document: { nodeId } }

{ source: "edu-sharing-onlyoffice-plugin", event: "DOCUMENT_INFO",
  data: { document, editorType, trigger, requestId }, document: { nodeId } }
```

- **`document` rides on every outbound envelope** (envelope level, including `PREVIEW_NODE`) and
  additionally inside `DOCUMENT_INFO`'s `data`. It is **`null`** when the editor was opened with a
  stale, cached plugin config — always null-check. `OnlyOfficeDocumentService` then keeps the last
  known identity instead of dropping it, and an enrichment without any node id falls back to
  creating a node on save, so the result is never lost.
- **`document` is the node id and nothing else.** It used to carry ten fields (title, permalink,
  mimetype, `editable`, `documentKey`, …) as base64url-JSON in the plugin's URL chain; that was
  dropped in favour of one plain `docNode` parameter — free-text fields forced the encoding and
  ended up in the document server's access logs. `OnlyOfficeDocumentService` loads the node once
  and derives `documentTitle` / `documentPermaLink` / `documentWritable` from it.
- **There is no `originalId`.** The connector's `OnlyOffice::getNode()` resolves a collection
  reference (`ccm:collection_io_reference` → `ccm:original`) to the original *before* reporting
  it, so the reported id already is the edited node — read it and save onto it directly.
- **Write permission** comes from the loaded node's `access` (`documentWritable`), not from the
  envelope. It is `null` while the node is unknown, and the enrich screen only warns on an
  explicit `false`; the repository rejects the save either way.
- **Never rename the node:** generated metadata carries no `cm:name`, and the node's name holds the
  document's file name incl. extension — so `RepositoryNodeService.update` fills `cm:name` from the
  node's current name (the title fallback applies to *creating* a node only).
- **Only `markdown` is consumed** by this extension. `html` + `documentJson` are the payload's
  bulk (megabytes with data-URI images); they are relayed but never read here.
- **`trigger`**: `"request"` for an answer to one of our requests, `"toolbar"` for the plugin's own
  toolbar button, `"announce"` for the one `DOCUMENT_INFO` on plugin startup. Unsolicited answers
  carry no `requestId` — the extension takes only the identity from them.
- **Error forms** (always with `trigger`/`requestId`/`document`): `{unsupported:true, editorType}`
  for a non-text editor (spreadsheet, presentation — `DOCUMENT_INFO` works in all types) and
  `{error:"read-failed"}`.
- **Every request is bounded by a timeout** (content 15 s, info 10 s): the page-side listener is a
  *background plugin* the user can switch off, in which case **no answer arrives at all** — not
  even the startup announce. So `DOCUMENT_INFO` is requested rather than waited for, since the
  announce is lost if the panel opened later.
- **`REQUEST_DOCUMENT_INFO` is sent once on sidebar boot**, gated on `conditions.onlyOfficePresent()`
  (`app.component.ts`) — without that gate every page would trigger a broadcast into all frames and
  a 10 s timeout. Its answer makes the edited document the **active node** right away
  (`CurationService.adoptOpenDocument`, driven by an effect on `documentNode()` so a panel opened
  logged out adopts it after login). The enrich screen still asks on open, guarded by
  `!currentDocument()`, as a fallback for a page the URL check does not match.
- **Not buffered:** `panel-host.js` buffers/persists only `PREVIEW_NODE`. A `DOCUMENT_CONTENT`
  replay would be stale, and persisting its `html`/`documentJson` would blow the `storage.local`
  quota.

### Internal chain
| # | From → To | Transport | Payload |
|---|-----------|-----------|---------|
| 1 | footer action → `CurationService.enrichOpenDocument()` → `MetadataAgentService.runForOpenDocument()` | — | — |
| 2 | `OnlyOfficeDocumentService.requestContent()` → `BrowserExtensionService` → host top | `window.parent.postMessage` | `{type:'edusharing-request-document-content', requestId}` |
| 3 | `panel-host.js` → all frames | `broadcastToFrames` (a single post to `window.top` would **not** reach the nested plugin frame) | `REQUEST_DOCUMENT_CONTENT` envelope |
| 4 | plugin → host top → sidebar iframe | `postMessage`, relayed by `panel-host.js` | `DOCUMENT_CONTENT` envelope |
| 5 | `app.component.ts` → `OnlyOfficeDocumentService.accept()` | filter `data.source`, match `requestId` | resolves the pending promise |
| 6 | `markdown` → background `analyze.text` → `POST /generate` → metadata screen | `runtime.sendMessage` | agent payload |
| 7 | `outcome.document` → `CurationService` active node (+ hydrated for the preview) → footer *Speichern* → `editNodeMetadata` | — | the document's own node |

---

## Debug mode — simulating the host side

`DebugService` (`app-src/src/app/services/debug.service.ts`) stands in for the host-side plugin, so
the OnlyOffice flows can be developed without an editor. Enabled in *Einstellungen* and persisted in
`storage.local` (`eduSharingDebugMode`).

| What | Behaviour with debug mode on |
|---|---|
| `ConditionsService.onlyOfficePresent` | always true → the OnlyOffice-only options are reachable on any page |
| `REQUEST_DOCUMENT_CONTENT` | never leaves the sidebar; answered with a `DOCUMENT_CONTENT` envelope carrying a hard-coded German test document (`markdown` + `text`, long enough for the agent's 50-character guard) |
| `REQUEST_DOCUMENT_INFO` | answered with a `DOCUMENT_INFO` envelope carrying the configured test node id |
| `PREVIEW_NODE` | nothing requests it → a button in the settings fires one for the test node |
| `INSERT_NODE` | **unchanged** — only the inbound direction is simulated; the outbound broadcast still goes to the host page |

Two properties make the simulation faithful:

- **Same route.** The answers are not returned from the call: they are posted to the sidebar's own
  window with the plugin's `edu-sharing-onlyoffice-plugin` marker, so `AppComponent`'s single
  `window:message` listener and `OnlyOfficeDocumentService.accept()` process them like relayed
  ones. `requestId` correlation, the timeout, the identity handling and the node hydration all run
  as in production.
- **Same envelopes.** Fixtures are typed against the contract in
  `app-src/src/app/model/onlyoffice-events.ts` — the file both the service and the simulator import
  (that split exists to keep them free of an import cycle).

The switch is read in `AppComponent.ngOnInit` **before** anything evaluates `onlyOfficePresent()`
(option visibility, the boot's `REQUEST_DOCUMENT_INFO`). The test node id is editable in the
settings: the default is deliberately fake, a real id makes even *Speichern* run through.
Simulated events are logged with the `[edu-sharing][debug]` prefix.

---

## `Node` Data Structure (elements in `INSERT_NODE`'s `nodes`)

The `nodes` are edu-sharing repository node objects as held by the `edu-sharing` web-component
bundle from the REST API (no TS class defined in this repo; the shape comes from the repository).
Typical, reliably present fields:

```jsonc
{
  "ref":  { "repo": "<repo-id>", "id": "<node-uuid>" },   // unique reference
  "aspects": ["ccm:..."],
  "type": "ccm:io",                                        // node type
  "name": "example.pdf",
  "title": "Example",
  "isDirectory": false,
  "mimetype": "application/pdf",
  "size": 12345,
  "properties": { "cclom:title": ["…"], "cm:name": ["…"], /* … */ },
  "preview": { "url": "https://…" },
  "downloadUrl": "https://…",
  "content": { "url": "https://…" }
}
```

Which fields a host application needs depends on the use case. For `PREVIEW_NODE` the host sends
only string fields and the extension re-hydrates from `id`.

---

## Things to Watch Out For

- **Distinct source markers:** extension→host uses `edu-sharing-browser-plugin`; host→extension
  uses `edu-sharing-onlyoffice-plugin`. They are intentionally different so neither side
  re-processes its own messages. Filter strictly by `source`.
- **Frame boundary:** across a cross-origin iframe boundary only `postMessage` works
  (`CustomEvent` does not cross it). `INSERT_NODE` and the `REQUEST_DOCUMENT_*` events are
  broadcast to all frames; the host's events target `window.top`.
- **Unknown events are ignored silently** on both sides, so adding one breaks nothing.
- **Marker required:** discard messages lacking the expected `source` **silently** (the host page
  receives many foreign `postMessage`s, e.g. the OnlyOffice editor's own internal messages).
- **No loop:** `panel-host.js` guards inbound-from-sidebar handling with
  `event.source === iframe.contentWindow`, and inbound-from-plugin handling with the
  `edu-sharing-onlyoffice-plugin` marker.
- **Where the sidebar appears** (trigger pages) is configured separately and is not part of these
  event contracts.
- **Debug:** log prefix `[edu-sharing][…]`. When debugging in DevTools, select the matching frame
  context.

---

## Files Involved

| File | Role |
|---|---|
| `app-src/src/app/components/search.component.ts` | selector's `onNodesChoosen` → `insertNodes` (outbound) |
| `app-src/src/app/services/browser-extension.service.ts` | `insertNodes`, `requestDocumentContent`, `requestDocumentInfo` (outbound), `signalReady` (ready handshake), `analyzeText` (→ background `/generate`) |
| `content/panel-host.js` | relay hub: broadcasts `INSERT_NODE` / `REQUEST_DOCUMENT_*`; relays inbound envelopes, buffers only `PREVIEW_NODE` |
| `app-src/src/app/app.component.ts` | single `window:message` listener: `DOCUMENT_*` → the document bridge, `PREVIEW_NODE` → the flow |
| `app-src/src/app/model/onlyoffice-events.ts` | the inbound contract: `PLUGIN_SOURCE` marker + `PluginEnvelope` / `DocumentContent` / `DocumentIdentity` payloads |
| `app-src/src/app/services/onlyoffice-document.service.ts` | the request/response bridge: `requestContent`/`requestInfo` (`requestId` + timeout), `accept(envelope)`, `currentDocument` |
| `app-src/src/app/services/debug.service.ts` | debug mode: answers the `REQUEST_DOCUMENT_*` events with hard-coded fixtures instead of asking the host page |
| `app-src/src/app/services/metadata-agent.service.ts` | `runForOpenDocument()` — document content → `markdown` → agent |
| `app-src/src/app/services/curation.service.ts` | `openNode(id)` (hydrate + open in the preview), `adoptOpenDocument(node)` (the open document as active node, no history entry), `enrichOpenDocument()` |
| `background/background.js` | `analyze.text` — `POST /generate` for text the sidebar supplies |
| *(host-side, external)* | app that listens for `INSERT_NODE` / `REQUEST_DOCUMENT_*` and sends `PREVIEW_NODE` / `DOCUMENT_*` (e.g. OnlyOffice plugin) |
