# Event Documentation — Browser Extension → Host Application

This file documents every event/message fired on the path from the sidebar selection
(`edu-sharing-nodes-selector`) to the **host application**: **which** events exist,
**when/how/where** they fire, and **what data structure** they carry.

The outward-facing event (`INSERT_NODE`) is deliberately **application-agnostic**: the
extension does not know which page it is embedded in. Any web application can consume it by
listening to the contract described below. OnlyOffice is just **one concrete example** — the
same works for H5P editors, CMS editors, custom web apps, etc.

The final, outward-facing station is `content/panel-host.js` (it fires the `INSERT_NODE`
envelope into all frames). The hops before it are internal intermediate steps.

---

## Frame / Context Map

```
Host page (any web application) ── content script: panel-host.js   (fires INSERT_NODE)
 ├─ Sidebar iframe (sidebar/index.html, extension origin) ── Angular app
 │    (search.component.ts, ext.service.ts)
 │   └─ Nodes-selector iframe (webcomponent/nodes-selector.html)
 │        (nodes-selector-bridge.js + <edu-sharing-nodes-selector>)
 └─ (optional) arbitrarily nested, possibly cross-origin iframes
      └─ consuming application  ── listens for INSERT_NODE   (e.g. OnlyOffice plugin)
```

The receiver may sit **on the top page itself** or in an **arbitrarily nested, cross-origin
iframe**. That is why the event is broadcast into *all* frames (see event 4). Each level is a
separate JS context with its own console. Debug logs carry the prefix `[edu-sharing][<station>]`.

---

## Event Chain Overview

| # | From → To | Transport | Identifier | Payload |
|---|-----------|-----------|-----------|---------|
| 0 | Sidebar → Bridge | `iframe.postMessage` | `{target:'nodes-selector', type:'init'}` | selector config |
| 1 | Bridge → Sidebar | `parent.postMessage` | `{source:'nodes-selector', type:'ready'\|'mounted'}` | `null` |
| 2 | Bridge → Sidebar | `parent.postMessage` | `{source:'nodes-selector', type:'copy'}` | `{nodes, connectorId}` |
| 3 | Sidebar → Host top | `window.parent.postMessage` | `{type:'edusharing-insert-node'}` | `{nodes}` |
| 4 | **Host top → all frames** | `postMessage` + `CustomEvent` | **`INSERT_NODE` envelope** | `{nodes}` |

Events 0–3 are **internal** (extension origin) and irrelevant to integrators. The **public
integration point is exclusively event 4 (`INSERT_NODE`)**.

---

## Public Contract (for host applications)

A host application integrates the extension by listening for the `INSERT_NODE` envelope. It
arrives over **two** transports (use at least `message`):

```js
const SOURCE  = "edu-sharing-browser-plugin";   // marker; ignore anything without it
const CHANNEL = "edu-sharing-browser-plugin";    // name of the CustomEvent

function parse(raw) {
  let p = raw;
  if (typeof p === "string") { try { p = JSON.parse(p); } catch { return null; } }
  if (!p || typeof p !== "object") return null;
  if (p.source !== SOURCE || !p.event) return null;   // foreign message → silently ignore
  return p;
}

function handle(envelope) {
  if (envelope.event === "INSERT_NODE") {
    const nodes = envelope.data.nodes;   // array of selected node objects
    // ... insert into your own application
  }
}

// Transport 1: window.postMessage (crosses frame boundaries, cross-origin)
window.addEventListener("message", (e) => { const env = parse(e.data); if (env) handle(env); });

// Transport 2: CustomEvent (only if the listener runs in the same frame as the sender)
const onCE = (e) => { const env = parse(e.detail); if (env) handle(env); };
window.addEventListener(CHANNEL, onCE);
document.addEventListener(CHANNEL, onCE);
```

**Extensibility:** new actions simply get a new `event` name inside the same envelope
(`{source, event, data}`). The `source` marker cleanly separates these events from other
`postMessage` channels on the host page.

---

## Event Details

### 0. `init` — sidebar configures the selector *(internal)*
- **Where:** `search.component.ts` → `post('init', …)`; received in `nodes-selector-bridge.js`.
- **When:** right after the bridge reports `ready` (once).
- **How:** `iframe.contentWindow.postMessage(msg, extensionOrigin)`.
- **Structure:**
  ```js
  { target: 'nodes-selector', type: 'init', detail: {
      tabBlacklist: ['collections', 'upload'],
      option: { option: 'SORT_INTO', trap: false, optionConfig: { state: 'search' } },
      primaryMode: 'activity'
      // parent deliberately NOT set → enables the emit branch on copy
  }}
  ```
- The bridge adds the `onNodesChoosen` callback into `option.optionConfig` (functions do not
  survive `postMessage`, so this is done here in the target context).

### 1. `ready` / `mounted` — bridge lifecycle *(internal)*
- **Where:** `nodes-selector-bridge.js` → `send('ready'|'mounted')`; received in `search.component.ts`.
- **When:** `ready` as soon as the custom element is registered; `mounted` after the element
  is appended to the DOM.
- **Structure:** `{ source: 'nodes-selector', type: 'ready'|'mounted', detail: null }`

### 2. `copy` — selection confirmed ("copy selected content") *(internal)*
- **Where:** `nodes-selector-bridge.js`, inside the injected `option.optionConfig.onNodesChoosen`;
  received in `search.component.ts` (`msg.type === 'copy'`).
- **When:** click on **"Gewählten Inhalt kopieren"**. The button internally calls
  `copyNodes()` → `emitNodes()` → `onNodesChoosen(...)`. **No DOM event** — only this callback
  (hence no `addEventListener` on the element is possible). Precondition: `parent` is **not**
  set (otherwise the selector copies internally instead of emitting).
- **How:** `parent.postMessage({source:'nodes-selector', type:'copy', detail}, extensionOrigin)`.
- **Structure:**
  ```js
  { source: 'nodes-selector', type: 'copy', detail: {
      nodes: Node[],          // array of selected nodes (see below)
      connectorId?: string    // optional, from the callback payload
  }}
  ```
  Note: the callback also provides `payload.window` (a Window reference) — it is **dropped**
  because it is not cloneable across `postMessage`.

### 3. `edusharing-insert-node` — sidebar → host top *(internal)*
- **Where:** `ext.service.ts` → `insertNodes()`; received in `content/panel-host.js` (`handler`).
- **When:** right after event 2, in `search.component.ts` via `this.ext.insertNodes(nodes)`.
- **How:** `window.parent.postMessage(msg, '*')` (sidebar iframe → host top page).
- **Structure:** `{ type: 'edusharing-insert-node', nodes: Node[] }`
- `panel-host.js` filters inbound messages via `event.source === iframe.contentWindow` (only
  its own sidebar), preventing foreign/echo messages.

### 4. `INSERT_NODE` — host top → application *(public)*
- **Where:** `content/panel-host.js`, branch `type === 'edusharing-insert-node'`.
- **When:** immediately after event 3.
- **How:** **broadcast into all frames** via `broadcastToFrames(window.top, envelope)` —
  recursive `frame.postMessage(envelope, '*')`. Reason: the receiver may sit in a nested,
  cross-origin iframe; `postMessage`/`CustomEvent` on the top page do **not** propagate there
  automatically. Additionally (fallback for a listener in the same frame) `window.dispatchEvent`
  + `document.dispatchEvent` of a `CustomEvent`.
- **Channel / marker constants:** `source` / `CustomEvent` name = `"edu-sharing-browser-plugin"`.
- **Envelope structure (the public contract):**
  ```js
  { source: "edu-sharing-browser-plugin",   // marker; without it the receiver discards it
    event:  "INSERT_NODE",                   // event name
    data:   { nodes: Node[] } }
  ```

---

## Things to Watch Out For

- **Only event 4 is public.** Integrators listen exclusively for the `INSERT_NODE` envelope;
  events 0–3 are internal implementation details.
- **No DOM event on copy:** internally the selection only arrives via the
  `option.optionConfig.onNodesChoosen` callback. If `parent` is set, the selector copies
  internally and fires **nothing**.
- **Frame boundary:** if the receiver sits in a cross-origin iframe, only the `postMessage`
  broadcast into all frames reaches it. `CustomEvent` does **not** cross the frame boundary
  (same-frame fallback only).
- **Marker required:** without `source: "edu-sharing-browser-plugin"` the receiver must ignore
  the message — the host page receives many foreign `postMessage`s. Discard foreign messages
  **silently** (do not warn).
- **No loop:** self-posts to the top page fail the `event.source !== iframe.contentWindow`
  guard in `panel-host.js`.
- **Where the sidebar appears** (trigger pages) is configured separately and is not part of
  this event contract.
- **Debug:** log prefix `[edu-sharing][…]`. When debugging in DevTools, select the matching
  frame context.

---

## Files Involved

| File | Role in the event chain |
|---|---|
| `webcomponent-host/nodes-selector-bridge.js` | injects `onNodesChoosen`, fires `ready`/`mounted`/`copy` |
| `app-src/src/app/components/search.component.ts` | sends `init`, receives `copy`, calls `insertNodes` |
| `app-src/src/app/services/ext.service.ts` | fires `edusharing-insert-node` to the top page |
| `content/panel-host.js` | fires the `INSERT_NODE` envelope into all frames |
| *(host-side, external)* | any application listening for `INSERT_NODE` (e.g. OnlyOffice plugin) |
