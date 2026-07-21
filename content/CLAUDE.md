# Event Documentation — Browser Extension ↔ Host Application

This file documents every event/message exchanged between the extension's sidebar and the
**host application** the extension is embedded in, in **both directions**: **which** events
exist, **when/how/where** they fire, and **what data structure** they carry.

The public events are deliberately **application-agnostic**: the extension does not know which
page it is embedded in. Any web application can integrate by using the contracts below.
OnlyOffice is just **one concrete example** — the same works for H5P editors, CMS editors,
custom web apps, etc.

Two public events cross the extension ↔ host boundary:

| Direction | Event | Meaning |
|-----------|-------|---------|
| **Extension → host** | `INSERT_NODE` | user picked node(s) in the selector ("Gewählten Inhalt kopieren") |
| **Host → extension** | `PREVIEW_NODE` | host asks the extension to preview/edit a node (e.g. user double-clicked an inserted object) |

`content/panel-host.js` (the content script on the host page) is the relay hub for both
directions. It fires `INSERT_NODE` into all frames, and relays inbound `PREVIEW_NODE` into the
sidebar iframe.

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
  (`CustomEvent` does not cross it). `INSERT_NODE` is broadcast to all frames; `PREVIEW_NODE`
  targets `window.top`.
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
| `app-src/src/app/components/search.component.ts` | selector's `onNodesChoosen` → `ext.insertNodes` (outbound) |
| `app-src/src/app/services/ext.service.ts` | `insertNodes` (outbound), `signalReady` (ready handshake) |
| `content/panel-host.js` | relay hub: broadcasts `INSERT_NODE`; relays/buffers inbound `PREVIEW_NODE` |
| `app-src/src/app/app.component.ts` | receives `PREVIEW_NODE`, routes it into the wizard |
| `app-src/src/app/services/curation.service.ts` | `loadFromNode(id)` — hydrate + open in wizard (preview + editable) |
| *(host-side, external)* | app that listens for `INSERT_NODE` / sends `PREVIEW_NODE` (e.g. OnlyOffice plugin) |
