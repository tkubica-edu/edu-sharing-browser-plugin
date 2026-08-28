# Architecture — parts, addresses, and where a save goes

- [The parts](#the-parts)
- [The metadata agent's address](#the-metadata-agents-address)
- [Network legs & CORS](#network-legs--cors)
- [Saving a content](#saving-a-content)

---

## The parts

```
Browser tab (any https page)
 │
 ├─ content/panel-host.js ......... injected on toolbar click; docks the panel as a
 │   │                              resizable <iframe> and relays host-page events
 │   └─ sidebar/index.html ........ the Angular app (app-src/), plus the packaged
 │                                  web-component bundles edu/ · wlo/ · boerdi/
 │
 ├─ content/content.js ............ injected per run; returns the page's extracted data
 │
 └─ background/background.js ...... panel state per tab, page extraction, screenshots,
     (sw.js on Chrome/Safari,       and the metadata agent's POST /generate + /nodes
      event page on Firefox)
                │
                ├──────────► Metadata agent  (via the repository's B-API proxy)
                └──────────► edu-sharing repository (login, nodes, collections)
```

- **Sidebar UI** (`app-src/`) — an Angular 21 standalone app, built to `sidebar/`. Every component
  sits in a folder of its own with its `.ts`, `.html` and `.scss`, grouped by domain: `template/` for
  the panel's frame (topbar actions, tab bar, session and assistant bars, main menu),
  `features/<domain>/` for the steps of the flow (`auth`, `content`, `curation`, `metadata`,
  `quality`, `filing`, `overview`, `assistant`, `settings`), and `shared/components/` for what more
  than one domain renders. Services, `model/` and `util/` are flat, as they carry no templates.
- **Panel host** (`content/panel-host.js`) — injected on toolbar click; mounts the sidebar as a
  docked, resizable `<iframe>` (drag the left edge; width persists). This is the cross-browser
  replacement for the Chromium-only side-panel API. It is also the relay hub for the host-page
  events ([content/HOST-EVENTS.md](content/HOST-EVENTS.md)).
- **Background** (`background/background.js` via `sw.js`) — toggles the panel, extracts the active
  tab's content (`content/content.js`), and **proxies the `/generate` call** so it runs from the
  service worker (portable across browsers, avoids page-CSP/CORS pitfalls).
- **Auth** runs inside the Angular app (the library owns its HttpClient); it calls
  `GET {repo}/edu-sharing/rest/authentication/v1/validateSession` with Basic auth. See
  [UI-SHELL.md](UI-SHELL.md#login-session-restore-and-the-guest-gate).

The web components the screens embed are loaded into the sidebar document itself — no iframes; see
[WEB-COMPONENTS.md](WEB-COMPONENTS.md).

## The metadata agent's address

Every agent call — `/health`, `/generate`, `/nodes`, `/extract-field` — goes to a repository's own
B-API proxy, `{repo}/rest/bapi/api/v1/proxy/metadata-agent-canvas` (`MetadataAgentApiService`).

Which repository is **pinned to the default one** for the moment
(`APP_CONFIG.defaultRepositoryUrl`, staging: `https://repository.staging.openeduhub.net/edu-sharing`)
— not taken from the repository URL in *Einstellungen*, so the agent stays reachable while that URL
points somewhere without a B-API of its own. Following the configured repository again is one
expression in that service. The two do have to agree, though: the proxy authorizes by repository
session, so the pinned agent only answers while the panel's session is one *that* repository issued.

This used to depend on `browserExtensionCustomWebComponent`, with every other repository served by
the agent's public deployment. That flag answers which *editor* the metadata screen embeds, which is
a different question from where the agent lives, so it no longer decides the address.

The proxy **authorizes by repository session**, so every leg has to carry the session cookie
explicitly (`credentials: 'include'`): a worker fetch and a cross-origin page fetch both send none by
default. A base that is wrong, or a session the proxy refuses, is reported by the `GET /health` that
precedes every `/generate` rather than as a failed extraction a minute later.

## Network legs & CORS

| Leg | Where it runs | Why |
|-----|---------------|-----|
| `POST /generate`, `POST /nodes` (Metadata-Agent) | background service worker | background fetch is gated by `host_permissions`, not CORS/page-CSP — portable everywhere (`analyze.run`: extract the tab, generate everything) |
| `POST /extract-field` (Metadata-Agent) | sidebar document (`MetadataAgentService`) | same context the WLO canvas calls `/generate` from, so the request is visible in the panel's own DevTools and there is no worker build that can fall out of sync with the app. Relies on `host_permissions` for the cross-origin call, like the repository login |
| Page content extraction | `scripting.executeScript` (background) | no cross-origin fetch |
| Repository login | Angular `HttpClient` (library) | the library owns the call; relies on `host_permissions` bypassing CORS on Chrome/Edge/Firefox |
| `EVENT` / `REQ` to a nostr relay (AMB, kind 30142) | sidebar document (`NostrForwardService` → `util/nostr-relay.ts`) | nostr has no HTTP path at all: one WebSocket per exchange — `publishToRelay` closes with the relay's `OK`, `queryRelay` with its `EOSE`. Needs `wss:`/`ws:` in the extension's `connect-src`, which the scheme sources for `https:`/`http:` do not have to imply. Neither runs while the settings' *Nostr-Relay verwenden* is off |

Every message to the worker goes through one send path (`BrowserExtensionService.ask`). A rejection
saying the message found **no receiver** is retried a few times with a short backoff instead of being
reported: the panel is an iframe the page's navigation destroys and the worker puts back, so its
messaging connection can still be settling while the panel is on screen and able to ask. Once the
attempts are used up the caller gets `WORKER_UNREACHABLE` — a state of its own, distinct from the
worker answering with a failure — and the user is told to reopen the panel. Every other rejection is
the worker's own and is passed on unchanged. See
[TROUBLESHOOTING.md § Browser-specific](TROUBLESHOOTING.md#browser-specific).

## Saving a content

The session decides which route a save takes, not the WLO flag (`CurationService.savesThroughAgent`):

- **A signed-in user writes the node themselves**, with the web component enabled as without it
  (`RepositoryNodeService.create`, `obeyMds=true`, in `-inbox-`). What the agent's `/nodes` pipeline
  would do besides writing the metadata is then done in turn, in the same order: the **folder** the
  *Persönliche Ablage* picked (`…/nodes/-home-/{parent}/children/_move`, a move because the content
  already exists by then), the WLO **extended fields** in a write of their own —
  `POST …/nodes/-home-/{id}/metadata?versionComment=EXTENDED_DATA&obeyMds=false` with
  `ccm:oeh_extendedType` (one value — what kind of thing the content is, out of `contentTypes`),
  `ccm:oeh_lrt` and `ccm:oeh_lrt_aggregated` (the material types, each a list out of its own
  vocabulary), `ccm:oeh_extendedData` (the whole payload as JSON, in the canvas' export shape) and
  `ccm:oeh_extendedText` (the raw text), because the metadata set defines
  none of them and a write that obeys it drops them silently; a bulk write the repository refuses is
  retried field by field (`RepositoryNodeService.writeExtendedData`) — then the **workflow steps**
  (`200_tocheck`, addressed to `GROUP_ORG_WLO-Uploadmanager` in a WLO panel, then
  `140_ELEMENT_LEGALLY_APPROVED`, each its own history entry), then the **collections**.
- **A guest session** (the web component's own, brought by the embedding host) may not write a node
  at all, so it saves through the agent's `POST /nodes`, which writes with the agent's privileges and
  does all of the above in one request (`node_id`, `collection_id`, `write_extended_data`,
  `start_quality_workflow`, `start_review_workflow`, `preview`; `NodeWriteService`).

  One thing cannot be honoured along that route, because the node is the agent's rather than the
  panel session's: a folder picked for the user's own storage — it always creates in the inbox the
  agent is configured with. The repository also only lets that endpoint edit a node **within two
  hours of its creation**; after that it answers 403 and the editorial interface takes over. The
  panel does not wait for that refusal: `CurationService.agentEditWindowClosed` compares the node's
  `createdAt` against the window, and the steps that write show the login in place of their screen
  (`AppSection.requiresSession`) — signing in is what lifts the limit, since a signed-in user takes
  the route above. The age is read when the content is taken up rather than from a running clock, so
  a flow that started inside the window is carried through to its end. Where the node states no
  creation date the refusal still arrives; it is then reported as what it is rather than in the
  repository's own words, which name the node's id, its creation date and its age in hours
  (`CurationService.agentRefusalText`).

**The picture** is a preview rather than a property, so neither route writes it with the metadata: it
is uploaded to the node (`POST …/nodes/-home-/{id}/preview`). Writing the node itself, the panel does
that upload (`RepositoryNodeService.setPreview`, a multipart `image`); along the agent's route the
endpoint does it, and the picture travels as the body's `preview` — the address it should fetch, or
the picture itself as a data URL for one the user picked in the widget
(`CurationService.previewToSend`). Either way it goes with the *Vorschau* step's save, and is not
sent again afterwards: the node then has a preview of its own. A picture that cannot be loaded or
decoded leaves the content written, and the endpoint says so in `preview.error` alone.

Which step writes what is [FEATURES.md § Filing and handing on](FEATURES.md#filing-and-handing-on) —
the content is created early and every later step adds what it decided.
