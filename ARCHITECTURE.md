# Architecture — parts, addresses, and where a save goes

- [The parts](#the-parts)
- [The metadata agent's address](#the-metadata-agents-address)
- [Network legs & CORS](#network-legs--cors)
- [The OAuth flow](#the-oauth-flow)
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
  `GET {repo}/edu-sharing/rest/authentication/v1/validateSession` with Basic auth — or with a bearer
  token, where the session was obtained through the OAuth flow below. See
  [UI-SHELL.md](UI-SHELL.md#login-session-restore-and-the-guest-gate).
- **OAuth/PKCE** (`background/oauth.js`, loaded by `sw.js` and by Firefox's `background.scripts`
  ahead of `background.js`) — the Authorization Code flow with PKCE that precedes that bearer login,
  run in the worker rather than in the panel. See [§ The OAuth flow](#the-oauth-flow).

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
| OIDC discovery, token exchange, refresh, revocation | background service worker (`background/oauth.js`) | same reason as `/generate`: a background fetch is gated by `host_permissions`, so the provider's token endpoint is reached without it having to allow the extension origin by CORS. It is also the only context that outlives the panel's iframe for the length of a login |
| `EVENT` / `REQ` to a nostr relay (AMB, kind 30142) | sidebar document (`NostrForwardService` → `util/nostr-relay.ts`) | nostr has no HTTP path at all: one WebSocket per exchange — `publishToRelay` closes with the relay's `OK`, `queryRelay` with its `EOSE`. Needs `wss:`/`ws:` in the extension's `connect-src`, which the scheme sources for `https:`/`http:` do not have to imply. Neither runs while the settings' *Nostr-Relay verwenden* is off |

Every message to the worker goes through one send path (`BrowserExtensionService.ask`). A rejection
saying the message found **no receiver** is retried a few times with a short backoff instead of being
reported: the panel is an iframe the page's navigation destroys and the worker puts back, so its
messaging connection can still be settling while the panel is on screen and able to ask. Once the
attempts are used up the caller gets `WORKER_UNREACHABLE` — a state of its own, distinct from the
worker answering with a failure — and the user is told to reopen the panel. Every other rejection is
the worker's own and is passed on unchanged. See
[TROUBLESHOOTING.md § Browser-specific](TROUBLESHOOTING.md#browser-specific).

## The OAuth flow

`background/oauth.js` implements the Authorization Code flow with PKCE (RFC 7636) as a public client
— no secret, an `S256` challenge in the authorization request and the verifier only in the token
exchange. The PKCE pair is generated the way
[`pkce-challenge`](https://github.com/crouchcd/pkce-challenge) does it (a 128-character verifier over
the unreserved set with the modulo bias cut off, SHA-256 as a base64url challenge), inlined because
this file is plain script the worker loads directly — there is no bundler on the extension's side.
Endpoints are never assembled: they come from the provider's discovery document, cached per document
address for the worker's lifetime, which is what lets one implementation serve Keycloak, Shibboleth
or edu-sharing's own authorization server. Which address that is has to be configurable, because two
paths are in use and the provider does not say which it serves: an OpenID Connect provider describes
itself at `<issuer>/.well-known/openid-configuration`, a plain OAuth authorization server at
`/.well-known/oauth-authorization-server` (RFC 8414) — edu-sharing's own among the latter. The
issuer's OIDC path is what an empty *Discovery-URL* falls back to; the issuer itself is still what a
stored session is recognised by, whichever document was read. The `state` is checked before the code is
looked at, so an answer belonging to another request is refused rather than exchanged.

**Showing the provider's pages** is the one part that differs per browser, and it is branched on the
API rather than on the browser:

| Browser | How | Redirect address |
| --- | --- | --- |
| Chrome, Edge, Firefox | `identity.launchWebAuthFlow` (needs the `identity` permission) | `identity.getRedirectURL()` — a per-extension address the browser makes up and never puts on the network |
| Safari | a watched tab: `tabs.create`, then `tabs.onUpdated` until the tab heads for the redirect address, which then closes it | an ordinary https address, configured or `<repository>/oauth/extension-callback` |

`launchWebAuthFlow` is handed `url` and `interactive` and nothing else: Chrome validates
`WebAuthFlowDetails` against its own schema and rejects an unknown property outright rather than
ignoring it, and both browsers read the redirect address out of the authorization URL. (Firefox
wanted an explicit `redirect_uri` between versions 75 and 86, below the 128 the Firefox manifest
declares as its minimum.)

The branch is on the redirect address, not on the browser (`usesIdentityApi()`):
`launchWebAuthFlow` completes only when the flow reaches the address the browser itself handed out —
Chrome watches for `https://<id>.chromiumapp.org/` and nothing else — so **a configured address takes
the watched-tab path everywhere**, which is how one https address can serve all three browsers.
Left unconfigured, each browser uses its own, and all of them have to be registered with the client.

Safari implements no `identity` namespace at all, which is what the fallback exists for
(`hasIdentityApi()`, and see
[TROUBLESHOOTING.md § Browser-specific](TROUBLESHOOTING.md#browser-specific)). The watched tab
matches on the address *before* the load finishes, so nothing has to be served at the redirect
target; a tab the user closes instead is a cancellation, which the panel reports as no error at all.
Both addresses have to be registered with the client at the provider, and *Einstellungen →
SSO-Anmeldung* shows which one this browser will use.

The worker hands the panel the access token and nothing else. The refresh token stays in
`browser.storage.local` under `eduSharingOAuthTokens` and is read only there — the panel names the
key in `APP_CONFIG.storageKeys.oauthTokens` merely so its storage keys are all in one place. A
provider that rotates refresh tokens is followed; one that rejects a refresh has its stored session
cleared, since that token will not start working again. Messages: `oauth.login`, `oauth.silent`,
`oauth.logout`, `oauth.redirectUri`, `oauth.checkIssuer` — the last reading the discovery document's
`scopes_supported` so a scope the issuer does not define is named in the settings rather than
refused, unreadably, on the provider's own error page.

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
