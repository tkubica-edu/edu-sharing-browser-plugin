# Load & test

- [Unit tests](#unit-tests)
- [Load the extension](#load-the-extension)
- [Dev mode (faked KI answers)](#dev-mode-faked-ki-answers)
- [Debug mode (OnlyOffice without OnlyOffice)](#debug-mode-onlyoffice-without-onlyoffice)
- [Manual test checklist](#manual-test-checklist)
- [Where errors show up](#where-errors-show-up)

Building first: [BUILD.md](BUILD.md).

---

## Unit tests

```bash
npm test                  # once, from the repo root
npm --prefix app-src run test:watch
npm --prefix app-src run test:coverage
npm --prefix app-src run test -- --include app/services/history.service.spec.ts
```

`ng test` runs the `@angular/build:unit-test` builder with the Vitest runner in a Node process with
jsdom — no browser and no extension. The target's `include` is `src/**/*.spec.ts`, and three kinds of
spec live under it: the service specs, each driving one service through `TestBed` with its
dependencies replaced, the pure specs next to `src/app/util/`, which need no `TestBed` at all, and
the two under `src/boundary/`, which are about no service (see [TEST-PLAN.md § Boundary contract
specs](TEST-PLAN.md#4-boundary-contract-specs--where-the-sidebar-meets-the-extension)). They are the
specs that read their subject instead of importing it, because none of the extension's plain-JS files
exports anything: `extension-contract.spec.ts` reads those files, `sw.js`, the manifests and the root
`config.js` off disk and checks each literal they share with the panel against the panel's own, while
`oauth-flow.spec.ts` goes further and *evaluates* `background/oauth.js` in a sandbox with `browser`,
`fetch` and `console` handed in — the OAuth flow is unreachable from the panel, so its PKCE pair, its
`state` check, its redirect matching and the watched-tab fallback Safari needs are exercised there
with the browser APIs faked.
`--include` patterns are relative to `src`, and `--list-tests` prints what the builder discovered
without running it.

**No test reaches a real service.** Three things stand in the way, in `app-src/src/testing/`:

- `no-network.setup.ts` replaces `fetch` **and `WebSocket`** per test with stand-ins that *record* the
  address and then throw, and fails the test in `afterEach` if anything was recorded. The recording is
  the load-bearing half: `fetchJson` in `util/json-api.ts` turns any `fetch` rejection into its own
  „&lt;service&gt; nicht erreichbar", and `publishToRelay` in `util/nostr-relay.ts` catches the
  constructor's throw and rejects with a message of its own — either of which a test could otherwise
  assert on and pass while having reached for the network. jsdom's `WebSocket` dials for real, and the
  relay address the panel ships with is a live one, so this is the guard that keeps a unit test off
  `wss://amb-relay.edufeed.org`. The same hook calls `HttpTestingController.verify()`, so an unanswered
  `HttpClient` request is named rather than left to time out. A spec that exercises one of these
  (`metalookup.service.spec.ts` for `fetch`, `fakeRelay()` in `nostr-forward.service.spec.ts` for the
  socket) stubs the global again itself, which runs later and wins — and points at `wss://relay.test`,
  a name reserved by RFC 2606 and therefore unresolvable, rather than at any real relay.
- `test-providers.ts` is the builder's `providersFile` and supplies `provideHttpClient()` plus
  `provideHttpClientTesting()` for every `TestBed`, so anything going through `ngx-edu-sharing-api`
  answers from the testing backend. `ApiConfiguration` is deliberately **not** provided: constructing a
  real library service fails with a `NullInjectorError` naming the token, which reads as "fake this".
- `extension-globals.setup.ts` installs `globalThis.chrome` and `globalThis.browser` whose only
  answering member is `runtime.id`; every other member throws and names
  `fakeBrowserExtension()`. See [TROUBLESHOOTING.md § Dependencies and runtime
  limits](TROUBLESHOOTING.md#dependencies-and-runtime-limits) for why that global has to exist at all.

`quiet-logs.setup.ts` silences `console.log` for every test — the services log a line per step by design
— and deliberately leaves `warn` and `error` alone, so a run still says when something went wrong. A spec
whose *subject* is a warning takes `warn` over itself and asserts the line instead
(`nostr-forward.service.spec.ts`: a relay that could not be reached, a stored key that could not be read).
It re-emits in `afterEach` anything the test never looked at, so silencing the expected lines does not make
that spec a place where a new warning can appear unnoticed.

A fourth setup file is there for one feature rather than to hold something back: `color-scheme.setup.ts`
gives the run a `(prefers-color-scheme: dark)` query a spec can answer (`setSystemDark()`), because
jsdom defines no `matchMedia` at all and the panel's *System folgen* is otherwise untestable. It has to
be a setup file: `util/system-theme.ts` takes its reference to `matchMedia` at module load, so a stub
installed from a spec body would arrive after the module it is meant for.

Fakes live in `app-src/src/testing/fakes/`, one file per faked service, each a factory returning the
fake and the knobs a spec drives it with. They are checked against the real surface with
`satisfies Partial<TheRealService>` and handed to DI through `provideFake()`, which holds the single
cast in the whole test setup — renaming a member of a real service turns every stale fake into a
compile error instead of leaving specs that pass against a surface the app no longer has.

Two rules a new spec has to obey:

- **`vi.mock()` on a relative import throws.** The builder injects an `angular:vitest-mock-patch`
  entry that refuses any specifier starting with `.` or `/`. Replace a dependency through
  `TestBed` providers instead — every service uses `inject()` field injection, so there is nothing else
  to work around.
- **`fakeAsync()` and `tick()` are unavailable.** The app is zoneless (`provideZonelessChangeDetection`
  in `app-src/src/app/app.config.ts`, `polyfills: []` in `angular.json`), so `zone.js/testing` is never
  loaded and those helpers throw. Use `vi.useFakeTimers()` with `await vi.advanceTimersByTimeAsync(ms)` for
  timers, and `TestBed.tick()` to flush an `effect()`.

Console logs are silenced per test so a report stays readable; `warn` and `error` are not. Set
`TEST_LOGS=1` to see the `[edu-sharing][…]` lines of the run you are debugging. `quiet-logs.setup.ts`
reads that variable through `process.env`, which is why `@types/node` is a devDependency of `app-src`
itself: `tsconfig.spec.json` inherits the default type resolution, and the CI `test` job installs the
sidebar's lockfile alone — nothing there may lean on the root install's transitive copy.

`npm run test:coverage` prints a summary and writes the report to `app-src/coverage/sidebar/`:
`index.html` to open in a browser and drill into a file's uncovered lines, `lcov.info` for an IDE or a
CI service. The directory is wiped at the start of each run and is gitignored. Coverage is off the
default `npm test` path on purpose — a break in the coverage provider then cannot fail CI.

`app-src/vitest.config.ts` exists for one reason: `ngx-edu-sharing-api` is left external by the test
build and imports `lodash`, a CommonJS package Node cannot take named exports from, so the library is
inlined to be routed through Vite instead.

Seventeen of the panel's 35 services are covered, of `src/app/util/**` one module is, and the
contracts with the extension around the panel are pinned. What is still uncovered, which kind of test
each part of it needs and in which order to work is [TEST-PLAN.md](TEST-PLAN.md).

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

**Safari without Xcode** (temporary, gone at the next Safari restart): *Settings* → *Advanced* →
tick **Show features for web developers** — that is what makes the *Developer* tab appear at all, so
it comes first — then *Developer* → *Extensions* → tick **Allow unsigned extensions** → **Add
Temporary Extension…** → pick the unzipped `safari` folder (`dist/safari`, or the unpacked
`edu-sharing-safari-<version>.zip`).

A rebuilt bundle or manifest needs an explicit *Reload* in the browser's extension page — neither
browser picks up a changed package on its own.

## Watch mode (rebuild on every change)

```bash
npm run dev:firefox    # ng build --watch + web-ext, Firefox reloads itself
npm run dev:chrome     # ng build --watch only, reload by hand on chrome://extensions
```

One command holds the whole loop open: `ng build --watch` (development configuration, unminified,
with source maps) rebuilds the sidebar app on every source change, and `scripts/build.mjs --watch`
copies that output, the extension's own `background/`, `content/`, `icons/`, `vendor/`, `config.js`,
`sw.js` and both manifests into `dist/<target>/` as they change. Nothing is zipped, and the committed
`sidebar/` — which holds the production build — is left untouched, so a watch session never dirties
the working tree.

`dev:firefox` also runs `web-ext run`, which watches `dist/firefox` and reloads the extension in its
temporary profile after each sync. Chrome has no such hook: press *Reload* on `chrome://extensions`.

Two things it is not:

- **Not HMR.** The panel is an extension-URL iframe (`content/panel-host.js`) under
  `script-src 'self'`, so a bundle served from `localhost:4200` cannot load — Angular's dev server
  and its hot module replacement are out of reach here by design of the manifest's CSP.
- **Not a live panel refresh.** A reloaded extension does not re-render an already-open panel: close
  it and click the toolbar icon again to see the new build.

Since a watch build is unoptimized, measure size and check budgets with a normal `npm run build`.

## Walking the core flow against a WLO repository

*Einstellungen* → *Entwickler-Optionen* → **WLO-Funktionen verwenden** (on by default,
`eduSharingWloEnabled`). Off, the panel reads `browserExtensionCustomWebComponent` as unset whatever
the repository answers, which is the only way to reach the base version's behaviour while connected
to a repository that sets the variable: the MDS editor instead of the WLO canvas, `edu-sharing-preview-sidebar`
instead of the canvas in `mode="detail"`, the repository's default metadata set instead of `mds_oeh`,
the login gate back in front of the flow, no *Prüfprozess auswählen* / *Individuelle Qualitätsprüfung
mit KI* / *Sammlung auswählen* / Boerdi and no *Qualität* tab, no `ccm:oeh_*` write and no
`200_tocheck` workflow on the save, and the three WLO-only settings groups gone from this screen.

The switch is read at every one of those places through the one signal they all hang on, see
[WEB-COMPONENTS.md § Refusing the variable](WEB-COMPONENTS.md#refusing-the-variable). It survives a
reload and takes effect on leaving the settings — the options menu is rebuilt then — so the extension
does not have to be reloaded to go back and forth. A repository that offers none of this leaves the
switch on and says so under it.

## Dev mode (faked KI answers)

*Einstellungen* → *Entwickler-Optionen* → **Dev-Modus: KI-Antworten faken** (`DevModeService`). The slow, paid services answer
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

Flipping the switch either way, and choosing another **Gefakter Inhalt**, also lets go of the content
the panel currently holds — it came out of the run those settings shaped, and *Geöffneter Inhalt*
would otherwise go on naming the old fixture while *Inhalt erschließen* stays disabled for the page.
This one does drop unsaved work: a faked run's result is a test result.

Three further settings appear while the mode is on, and hold only while it is (the second one only in
a WLO panel, see there); ticking the last one adds a fourth:

- **Gefakter Inhalt** — which erschlossener Inhalt `/generate` answers with. `dresden` is a sound
  content; `optik` carries factual errors in its text on purpose, so a quality check has something to
  find. The payloads live in `background/dev-fixtures.js` (the worker answers that call); the select's
  ids come from `GENERATE_FIXTURES` in `dev-mode.service.ts` and have to stay in step with that
  object's keys.
- **Test-Sammlungs-ID** — the collection every step that works off one is to work off. Shown only in a
  WLO panel (`browserExtensionCustomWebComponent`), since the steps it feeds — the KI check, the
  collection proposal, the forwarding — exist only there. It takes three places at once, so no step has
  to be walked for it:
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
- **Node-ID des Prüfinhalts** — shown while the writes are skipped, and the node the content counts as
  for the KI check (`DevModeService.fakedNodeId`, read through `CurationService.subjectNodeId`). Without
  it the assistant is handed the test collection alone, resolves *that* as the current page and answers
  that the content to be checked is not available — the collection describes itself, and the content's
  own text is dropped from the prompt on the way. Put a real, readable node id of the repository in,
  ideally one whose content matches the **Gefakter Inhalt** above: the assistant reads its metadata and
  full text from it. It never becomes the target of a save — while it applies, nothing is written.

### Reaching „Individuelle Qualitätsprüfung mit KI" quickly

1. Switch the dev mode on, put a real collection id into **Test-Sammlungs-ID**, tick **Nichts ins
   Repositorium schreiben** and put a real node id into **Node-ID des Prüfinhalts**.
2. *Inhalt erschließen* on any page → the faked run answers at once.
3. *Weiter* through Vorschau and whichever filing steps apply — none of them writes now.
4. *Prüfprozess auswählen* → **Individuelle Qualitätsprüfung mit KI** → the dialogue runs against the
   collection from the settings.

The check needs no node of its own to be *reached* (the section asks for `hasEditableMetadata`, which
the faked run satisfies), so the run ends on the menu rather than the Inhaltsübersicht — that step is
about a node, and this run wrote none. The dialogue itself does need one, which is what **Node-ID des
Prüfinhalts** is for. To test the writing instead, untick the checkbox and walk the same path.

## Debug mode (OnlyOffice without OnlyOffice)

*Einstellungen* → *Entwickler-Optionen* → **Debug-Modus: OnlyOffice-Events simulieren**. With it on, the sidebar behaves as
if it ran on an OnlyOffice page with the edu-sharing plugin active:

- every page counts as an insert host (`ConditionsService.onlyOfficePresent` is true throughout), so
  *Metadaten anreichern*, *Passende Inhalte finden* and *Inhalt suchen* are reachable anywhere;
- each `REQUEST_DOCUMENT_CONTENT` / `REQUEST_DOCUMENT_INFO` is answered immediately with a
  hard-coded test document (`app-src/src/app/services/debug.service.ts`) instead of being broadcast
  to a page that would never reply;
- `PREVIEW_NODE` has no request to answer, so the settings offer a button that fires one;
- the *Einstellungen* screen marks the state, and every simulated event is logged as
  `[edu-sharing][debug]`.

The answers are injected through the **real** inbound path (a window message carrying the plugin's
source marker), so `requestId` correlation, identity handling and node hydration run exactly as in
production. Only the inbound direction is faked — `INSERT_NODE` still goes to the host page as usual;
why that makes the simulation faithful to the contract is
[content/HOST-EVENTS.md § Debug mode](content/HOST-EVENTS.md#debug-mode--simulating-the-host-side).

**Test-Node-ID** is what the simulated document reports as the edited node. The default is a fake id
(the repository load fails silently and the UI falls back to that id); put a real node id in to
exercise the whole flow including *Speichern*. The flag is persisted in `storage.local`
(`eduSharingDebugMode`) and read in `AppComponent.ngOnInit` **before** anything evaluates
`onlyOfficePresent()`, so it survives reloads inside the extension — in a plain `ng serve` there is no
extension storage and it resets per session.

## An identity provider to test the SSO login against

The SSO login needs an OpenID Connect provider that (1) publishes a discovery document at
`<issuer>/.well-known/openid-configuration`, because that is where the endpoints are read from, and
(2) accepts the token exchange **without a client secret**, because a public client cannot keep one
(see [ARCHITECTURE.md § The OAuth flow](ARCHITECTURE.md#the-oauth-flow)). That rules out some of the
obvious candidates:

| Provider | Usable | Why |
| --- | --- | --- |
| Keycloak (local) | yes | Public client with `Client authentication` off, PKCE `S256`, `offline_access` for the refresh token, and a `revocation_endpoint` so *Abmelden* is exercised too. Also the shape edu-sharing federates in, so `oauthEntries` → `kc_idp_hint` matches |
| GitLab.com | yes | A non-confidential application does PKCE without a secret. Note its scopes: there is no `offline_access` — asking for one is an `invalid_scope` |
| Microsoft Entra ID, Auth0, Okta | yes | Their SPA/native client types are secret-less and PKCE-only |
| Google | **no** | The token endpoint requires `client_secret` for every client type, and a refresh token additionally needs `access_type=offline` — a query parameter, not a scope, so it cannot be reached through the *Scopes* field |
| GitHub | **no** | No OIDC discovery document at all (`/.well-known/openid-configuration` is a 404), and the token endpoint requires the client secret |
| Hosted playgrounds and demo servers (`oauth.net/playground`, `demo.duendesoftware.com`, …) | **no** | Their clients are registered against *their own* redirect URIs, and a browser extension's address is per-installation — so the code never comes back to the extension. The oauth.net playground additionally publishes no discovery document and mints its `client_id` per visitor. Client registration has to be yours, which is what the two recipes below are for |

### Keycloak in one container

```bash
docker run --rm -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.0 start-dev
```

On Keycloak 24/25 the variables are `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`. Then in the admin
console at `http://localhost:8080`:

1. **Realm** → *Create realm* → name it `edu-sharing`.
2. **Clients** → *Create client* → Client ID `edu-sharing-browser-extension`. On the next step leave
   **Client authentication off** — that is what makes it a public client — with *Standard flow*
   ticked and *Direct access grants* unticked.
3. On the client's **Advanced** tab set *Proof Key for Code Exchange Code Challenge Method* to
   `S256`, so the realm refuses a flow that omits the challenge instead of quietly allowing it.
4. **Valid redirect URIs** — see below; leave the rest of the client alone.
5. **Users** → *Create user*, then its *Credentials* tab → set a password, *Temporary* off.

Then in the panel, *Einstellungen → SSO-Anmeldung*:

| Field | Value |
| --- | --- |
| Issuer | `http://localhost:8080/realms/edu-sharing` |
| Client-ID | `edu-sharing-browser-extension` |
| Scopes | `openid profile email offline_access` |
| Redirect-URI | leave empty for a Chrome-only test, else see below |

`http://localhost` is reachable because the manifest declares `http://*/*` and the CSP names `http:`;
nothing has to be served over TLS for a local run.

### Which redirect URI to register

The group in *Einstellungen* reports the address this browser will actually use — that is the value
to paste into Keycloak's *Valid redirect URIs*, and it is the one thing that cannot be guessed.

- **Leaving the field empty** is the least work for a single browser: Chrome and Edge report
  `https://<extension-id>.chromiumapp.org/`, Firefox reports a per-profile
  `https://<uuid>.extensions.allizom.org/`. Each is different, so testing all three means
  registering all three — and Firefox's changes when the profile does.
- **Filling the field in** makes every browser take the watched-tab path instead of its own API, so
  **one address serves all three** — including Safari, which has no `identity` API to offer one. Any
  https address the extension has host permissions for will do; it needs to serve nothing, since the
  flow matches on the address and closes the tab before the load finishes. The default Safari
  fallback, `<Repository>/oauth/extension-callback`, is a reasonable choice. Should the request reach
  that server after all, the authorization code in it is useless on its own: it is single-use and
  bound to a PKCE verifier that never leaves the extension.

### GitLab.com instead of a container

*User Settings → Applications → Add new application*: paste the redirect URI as above, leave
**Confidential unticked**, and tick the scopes `openid`, `profile`, `email`. In the panel use issuer
`https://gitlab.com`, the *Application ID* as the Client-ID, and scopes `openid profile email` —
**without** `offline_access`, which GitLab does not define. Unverified against a live instance: its
discovery document does not advertise `none` among `token_endpoint_auth_methods_supported` even
though the documented PKCE flow sends no secret, so if the token exchange comes back
`OAUTH_TOKEN_FAILED: 401`, that is the reason and Keycloak is the way on.

## Manual test checklist

What the unit tests above cannot answer, and what this list is therefore for: anything that needs a
real browser, a real repository or a real host page — the panel's own docking and resizing, the
embedded web components, the repository's answers, and the OnlyOffice event exchange.

1. **Panel.** Toolbar click → the sidebar docks on the right; drag its left edge to resize; the ✕
   button closes it — and the page must take the freed width back immediately (no empty strip), also
   after a later window resize and after closing straight out of a drag. The start view is the menu,
   which lists the options visible for the current page (on an OnlyOffice page *Inhalt suchen* first,
   and nothing opens on its own), and the topbar carries the *Verlauf* / *Einstellungen* icons.
2. **Einstellungen** (topbar icon, reachable while logged out): the Repository-URL defaults to
   `https://repository.staging.openeduhub.net/edu-sharing` and is required. Changing it shows an
   *Übernehmen* button that reloads the sidebar so the library re-initializes against the new
   repository (a dot marks the icon until applied).
3. **WLO abschalten**: against a repository that sets `browserExtensionCustomWebComponent`, untick
   *Einstellungen* → *Entwickler-Optionen* → **WLO-Funktionen verwenden** and leave the screen — the
   panel must lose the WLO palette, ask for a login, and offer neither *Prüfprozess auswählen* nor the
   *Qualität* tab nor Boerdi; the metadata screen must show the MDS editor. Tick it again and all of
   it must come back without reloading the extension. Everything below is walked with it ticked.
4. **Login**: required for everything except *Einstellungen*. Enter staging credentials → the session
   bar flips to "Angemeldet: …" and the login option disappears while the rest appear. If the
   repository URL was changed, login is blocked until it is applied in *Einstellungen*.
5. **SSO-Anmeldung** (needs an identity provider — see
   [§ An identity provider to test the SSO login against](#an-identity-provider-to-test-the-sso-login-against)):
   enter the issuer and the client id under *Einstellungen* → *SSO-Anmeldung*, register the address
   the group reports as the redirect URI with the client at the provider, then use the button below
   the credential form on the login card. The provider's pages must open (a `launchWebAuthFlow` window on Chrome, Edge and
   Firefox; a tab that closes itself on Safari), and the session bar must flip to "Angemeldet: …"
   afterwards. Then close the panel and reopen it: the session must come back without the provider
   being shown again — that is the stored refresh token. *Abmelden* must end it for good, i.e. the
   next open must ask again rather than sign back in. Closing the provider's window instead must
   leave the login card exactly as it was, with no error on it. **Untested on Safari**, see
   [TROUBLESHOOTING.md § Browser-specific](TROUBLESHOOTING.md#browser-specific).
6. **Erschließen + speichern**: *Inhalt erschließen* on a content page → the metadata screen shows
   `fields_extracted / fields_total` and loads the MDS editor with the generated metadata. Edit, then
   the footer's **Speichern** → a node is created in your inbox and the preview opens, and the flow's
   steps become reachable for that content.
7. **Metadaten anreichern** (OnlyOffice): open a document in the OnlyOffice editor with the
   edu-sharing plugin active, open the panel → the option appears and names the detected document.
   The footer's **Metadaten anreichern** reads the document and lands on the metadata screen with the
   generated metadata, the menu naming the document under *Inhalt erkannt*. **Speichern** must update
   **that** node — check in the repository that the document's metadata changed, that its
   name/extension is unchanged, and that no new node appeared in the inbox. With the page-side plugin
   switched off (*Plugins im Hintergrund*) the screen must report the timeout instead of hanging.
8. **Vorschau → Sammlungen**: from the preview, *Sammlung zuordnen* → pick a collection and confirm
   with *In Sammlung einfügen*; the screen lists what was added.
9. **An Nostr Relay weiterleiten**: the step is reached in the base version too — against a repository
   *without* `browserExtensionCustomWebComponent` it must show the relay row alone, with no Redaktionen
   list, no „keine Redaktionen konfiguriert" line and no collection request in the network tab. The
   *Nostr-Relay* group in *Einstellungen* must be there in that version too — the step is, so its relay
   address has to be settable. Tick the relay row → the footer reads *An Relay senden*. Press it → the
   step stays open and the receipt appears: relay, `npub`, event id, the tags that went out, and the
   lookup commands. Verify against the relay itself with the receipt's own
   `nak fetch <naddr…>` (or paste its `REQ` frame into `websocat`) — the record that comes back must
   carry the same `d`, `name` and `t` tags. Pressing *Weiter* again must lead on **without** publishing
   a second event. Point the relay in *Einstellungen* at something unreachable to see the refusal
   reported in the step instead of the flow moving on. This needs a real browser: WebSockets are what
   the unit tests stub.

   Then untick *Nostr-Relay verwenden* in *Einstellungen*: the relay row must be gone from this step,
   *An Nostr Relay senden* gone from the *Inhaltsoptionen*, and the *Nostr-Anbindung* half gone from
   the *Interaktionen* — with no `wss:` connection in the network tab from any of the three. Against a
   repository *without* `browserExtensionCustomWebComponent` the whole step must then be gone from the
   flow as well, since it has no target left. Ticking it again brings all of it back, with the relay
   row unticked and no receipt carried over.

10. **An Nostr Relay senden** (Inhaltsoptionen, between *Inhalt teilen* and *Interaktionen anzeigen*):
   open a node from the *Verlauf* → the row appears and opens a step of its own — the Inhaltsübersicht
   must **not** grow a tab for it. The screen names the `d` tag and the field count
   it would publish, with the standing card above it. *An Relay senden* publishes it; the button then
   reads *Erneut senden*, and a second press must produce a second event with the **same** `d` tag (fetch
   the record twice with the receipt's `nak fetch <naddr…>` and compare the event ids). Point the relay
   at an unreachable address to check that the previous receipt stays and the failure is reported beside
   it. A node without `ccm:wwwurl` must be refused before anything is sent.

   Then **reload the panel** and open the same node again: the record must reappear — read back off the
   relay, not out of the *Verlauf* — labelled „Beim Nostr-Relay hinterlegt". Clearing the *Verlauf* must
   change nothing about that. With the relay pointed at an unreachable address the state must read
   **Unbekannt**, never „Nicht gesendet".
11. **Verlauf**: every *saved* node is listed (nothing is recorded until you save); entries expand to
   show their fields and offer *In Vorschau öffnen*, which reloads the node from the repository;
   *Leeren* clears the list.

## Where errors show up

The embedded elements run in the **sidebar document**, not in a frame of their own, so their failures
appear in the sidebar frame's console — select that frame in DevTools. If an embedded element stays
blank, look there for CSP or repository-CORS errors first.

Every log the extension writes itself carries the prefix `[edu-sharing][<station>]`. The background
worker logs to the extension's own console (`chrome://extensions` → *service worker*,
`about:debugging` → *Inspect*).
