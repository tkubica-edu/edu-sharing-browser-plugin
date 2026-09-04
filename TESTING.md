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
jsdom — no browser and no extension. The target's `include` is `src/**/*.spec.ts`, and four kinds of
spec live under it: the service specs, each driving one service through `TestBed` with its
dependencies replaced, the pure specs next to `src/app/util/`, which need no `TestBed` at all, the
component specs, which render through `TestBed.createComponent` and assert on the DOM the template
produced, and the two under `src/boundary/`, which are about no service (see [TEST-PLAN.md § Boundary contract
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

Most of the `util/` specs are value-in/value-out and set nothing up. Three groups of them are not, and
each says in the file how it holds its ground:

- **The specs whose subject is a patched global** — `bundle-windows.spec.ts` (`window.open`),
  `bundle-requests.spec.ts` and `bundle-language.spec.ts` (`XMLHttpRequest.prototype`). Each replaces
  the prototype member with a spy **before** installing the patch, so what the patch keeps as "the
  native one" is that spy: nothing dials out, and what is let through is visible. Every one of those
  installs is idempotent through a module-level flag it shares with production, so it happens once per
  spec file and a second call only refreshes what it points at. `bundle-windows.spec.ts` additionally
  gives the document a `<base href="chrome-extension://…">`, so the URLs the bundle composes resolve
  the way they do in the extension rather than against jsdom's `http://localhost`.
  `chat-session.spec.ts` denies `localStorage` by spying `Storage.prototype` and restoring in a
  `finally`, deliberately not through `vi.stubGlobal` — a storage left denied breaks every test after
  it rather than that one.
- **`system-theme.spec.ts`, which decides when its subject is loaded.** `util/system-theme.ts` takes
  its `matchMedia` reference at module load on purpose, and a worker runs several spec files against
  one jsdom — so an already-imported instance holds whichever reference the file that imported it
  first found. The spec calls `vi.resetModules()` and `await import('./system-theme')` per test, and
  drives the answer with `setSystemDark()` from `color-scheme.setup.ts`.
- **`quality-check-request.spec.ts`, which pins the outgoing tasks as a golden file.** The five tasks
  of the KI check are long German texts whose wording is the behaviour, so the spec renders every one
  of them over every branch that changes it — 39 sections — into
  `src/app/util/__snapshots__/quality-check-request.txt` through `toMatchFileSnapshot`. A change shows
  up as a diff; `npm --prefix app-src run test -- -u` records the new wording once it is meant. The
  couplings those texts carry are pinned as ordinary assertions in `ai-prompts.spec.ts` instead — the
  chip labels, the footer's own label, and the verdict glyphs, which are checked by running
  `installChatOverrides` over each glyph the task asks for rather than by restating the list.

**No test reaches a real service.** Three things stand in the way, in `app-src/src/testing/`:

- `no-network.setup.ts` replaces `fetch`, `WebSocket` **and `XMLHttpRequest.prototype`** per test with
  stand-ins that *record* the address and then throw, and fails the test in `afterEach` if anything was
  recorded. The recording is
  the load-bearing half: `fetchJson` in `util/json-api.ts` turns any `fetch` rejection into its own
  „&lt;service&gt; nicht erreichbar", and `publishToRelay` in `util/nostr-relay.ts` catches the
  constructor's throw and rejects with a message of its own — either of which a test could otherwise
  assert on and pass while having reached for the network. jsdom's `WebSocket` dials for real, and the
  relay address the panel ships with is a live one, so this is the guard that keeps a unit test off
  `wss://amb-relay.edufeed.org`. The same hook calls `HttpTestingController.verify()`, so an unanswered
  `HttpClient` request is named rather than left to time out. A spec that exercises one of these
  (`metalookup.service.spec.ts` for `fetch`, `fakeRelay()` in `nostr-forward.service.spec.ts` for the
  socket) stubs the global again itself, which runs later and wins — and points at `wss://relay.test`,
  a name reserved by RFC 2606 and therefore unresolvable, rather than at any real relay. The XHR guard is
  on the *prototype*, because that is where `util/bundle-requests.ts` and `util/bundle-language.ts` patch
  it and jsdom's own implementation dials for real; a spec whose subject is one of those patches keeps the
  patched members and re-applies them in its own `beforeEach`, which runs after this one.
- `test-providers.ts` is the builder's `providersFile` and supplies `provideHttpClient()` plus
  `provideHttpClientTesting()` for every `TestBed`, so anything going through `ngx-edu-sharing-api`
  answers from the testing backend. `ApiConfiguration` is deliberately **not** provided: constructing a
  real library service fails with a `NullInjectorError` naming the token, which reads as "fake this".
- `extension-globals.setup.ts` installs `globalThis.chrome` and `globalThis.browser` whose only
  answering member is `runtime.id`; every other member throws and names
  `fakeBrowserExtension()`. See [TROUBLESHOOTING.md § Dependencies and runtime
  limits](TROUBLESHOOTING.md#dependencies-and-runtime-limits) for why that global has to exist at all.
  The one spec that may not fake the wrapper away is the one whose subject *is* it,
  `browser-extension.service.spec.ts`, and `useExtensionApi(api)` / `resetExtensionApi()` are its way
  in: `webextension-polyfill` reads the global once, at import, and re-exports it unchanged when it
  carries a `runtime.id`, so the service holds *this proxy* for the life of the worker — neither
  assigning `globalThis.browser` from a spec body nor `vi.resetModules()` before a dynamic import
  reaches it, since the builder bundles the specs with esbuild and its chunks are not the Vite module
  graph. Swapping what the proxy answers out of is what is left, and every test puts the refusal back.

`quiet-logs.setup.ts` silences `console.log` for every test — the services log a line per step by design
— and deliberately leaves `warn` and `error` alone, so a run still says when something went wrong. A spec
whose *subject* is a warning takes `warn` over itself and asserts the line instead
(`nostr-forward.service.spec.ts`: a relay that could not be reached, a stored key that could not be read).
It re-emits in `afterEach` anything the test never looked at, so silencing the expected lines does not make
that spec a place where a new warning can appear unnoticed.

`timezone.setup.ts` pins the run to **UTC**, and runs before every other setup file. The panel formats
dates in the reader's own zone (`DatePipe` without a zone argument), which is right for the product and
makes an assertion on a rendered date depend on where the suite runs — green in Berlin, red on a CI
runner in UTC. Pinning it in one place is what lets a spec state the rendering of a fixture instant
outright. UTC rather than the zone the panel is used in, because it has no daylight saving: under
`Europe/Berlin` the rendering of a fixture would depend on the time of year it falls in.

A fifth setup file is there for one feature rather than to hold something back: `color-scheme.setup.ts`
gives the run a `(prefers-color-scheme: dark)` query a spec can answer (`setSystemDark()`), because
jsdom defines no `matchMedia` at all and the panel's *System folgen* is otherwise untestable. It has to
be a setup file: `util/system-theme.ts` takes its reference to `matchMedia` at module load, so a stub
installed from a spec body would arrive after the module it is meant for.

Two things about it are the scars of a CI failure, and both are load-bearing. Its state lives on
`globalThis`, not in the module: a spec that reloads its subject calls `vi.resetModules()`, which
re-evaluates this file too, and the state would otherwise split — the `matchMedia` installed from one
instance answering out of a `dark` flag the other instance's `setSystemDark` never touches. And it
exports `installColorSchemeQuery()`, because `util/bundle-theme.ts` replaces `matchMedia` for the rest
of the jsdom's life and a worker shares one jsdom across spec files: `bundle-theme.spec.ts` puts this
query back in an `afterAll`, and `system-theme.spec.ts` puts it back again before each reload of its
subject. Without either, whichever spec reads the preference after `bundle-theme.spec.ts` reads the
*panel's* theme instead of the one it stated — which is what happened, on CI only, once the file count
changed enough to reshuffle the workers.

Fakes live in `app-src/src/testing/fakes/`, one file per faked service, each a factory returning the
fake and the knobs a spec drives it with. They are checked against the real surface with
`satisfies Partial<TheRealService>` and handed to DI through `provideFake()`, which holds the single
cast in the whole test setup — renaming a member of a real service turns every stale fake into a
compile error instead of leaving specs that pass against a surface the app no longer has. The knobs are
named after what the other side *does*, not after what it answers with: `refuses(method)`,
`refusesProperty(name)`, `holds(node, inside)`, `analyzes(payload, source)`, `federates()`. That is
what lets a spec reach a retry path — `RepositoryNodeService.writeExtendedData` writing field by field,
`SuggestionService.propose` entry by entry — by stating the refusal rather than by matching a URL.
`edu-sharing-api.fake.ts` covers the library's own services the same way (`fakeNodeApi`,
`fakeCollections`, `fakeConnectors`, …).

Two things about DI that cost time before they were written down. A root-provided service is **one
instance per `TestBed`**, so a spec that wants a second one carrying different state needs a second
`it()`, not a second `TestBed.inject()`. And a spec that uses the real `ConditionsService` — which is
the recommendation, since it is a derivation over fakes that exist — has to provide `fakeAuth()`
alongside it: the real `AuthService` behind it injects the `BOOT_ROOT_URL` token, which no `TestBed`
here provides, and the failure reads as a missing provider for a token the spec never mentions.

A component spec renders rather than driving the class: `TestBed.createComponent`, inputs through
`fixture.componentRef.setInput`, outputs through `subscribe`, and every assertion against the rendered
DOM — the components worth a spec are the ones whose template is the interesting half. A click is
`input.checked = …` followed by `input.dispatchEvent(new Event('change'))` and a `detectChanges()`;
zoneless makes the handler run synchronously, so nothing else is needed. Two traps cost time here and
are worth knowing before the third spec: a `computed` that *calls* a spy does not re-evaluate when that
spy's return value changes, because no signal moved — a test wanting the other answer builds the
fixture with it from the start; and `mockReturnValue` outlives the test that set it, since `mockClear()`
only forgets the calls, so a spy shared across a file is re-stated with `mockReset()` plus
`mockImplementation` in `beforeEach`. The components that mount a vendored web component have no spec
and are excluded from the coverage figure by name — see
[TEST-PLAN.md § Component specs](TEST-PLAN.md#3-component-specs--testbedcreatecomponent-in-jsdom).

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

**A leak between spec files shows up only when they share a worker.** Vitest spreads the files over as
many workers as the machine has cores, so a laptop and a CI runner group them differently and an
ordering bug can be invisible on one and fatal on the other. To force the worst case — every file in
one worker, against one jsdom, in order — add `fileParallelism: false` to `app-src/vitest.config.ts`
and run the suite. It is the check to make after adding a spec that patches a global, and it is how
the two failures above were reproduced.

`npm run test:coverage` prints a summary and writes the report to `app-src/coverage/sidebar/`:
`index.html` to open in a browser and drill into a file's uncovered lines, `lcov.info` for an IDE or a
CI service. The directory is wiped at the start of each run and is gitignored. Coverage is off the
default `npm test` path on purpose — a break in the coverage provider then cannot fail CI.

`app-src/vitest.config.ts` exists for one reason: `ngx-edu-sharing-api` is left external by the test
build and imports `lodash`, a CommonJS package Node cannot take named exports from, so the library is
inlined to be routed through Vite instead.

Thirty-five of the panel's 44 services are covered, all 37 modules under `src/app/util/**` are, as are
`model/navigation.ts`, `config.ts` and the pipe, and the contracts with the extension around the panel
are pinned, `curation.service.ts` included — the panel's state hub, covered in three files split by
method group (its derived state, its write path, and taking a content back up). What is still
uncovered — six services around it, and the components — and in which order to work is
[TEST-PLAN.md](TEST-PLAN.md).

**That no test reaches the network is checked, not assumed.** `unshare -rn npm test` runs the whole
suite inside a network namespace with no interfaces at all; it passes, which is the proof that nothing
in it speaks to ContentJudge, MetalookUp, the metadata agent, the topic assistant, a nostr relay or a
repository. Worth re-running after a round that adds specs with an outbound call in them.

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
**And no `/generate`**: the Erschließung then reads the page (`page.read`) and describes the content
from the page's own declarations, while the repository's own generation proposes what is left at the
Metadaten step ([SUGGESTION-API.md](SUGGESTION-API.md#erzeugen-lassen-der-b-api-lauf)).

This is also the way to walk the path for a repository that has neither. Filter the panel's console on
`[edu-sharing][derived]` — one line per Erschließung naming every field, whether it entered as a value
or as a proposal, and which declaration it came from — and on `[edu-sharing][valuespace]`, which says
which of the page's own words a widget's vocabulary resolved. What to expect of it is
[FEATURES.md § Metadata without a model](FEATURES.md#metadata-without-a-model). Four pages are worth
walking: one with a `link[rel=license]`, a `meta[description]` and `article:tag` (description,
keywords and a chosen CC licence in the form, the derived keywords carrying the pending marking); one
that declares nothing at all (the title and nothing invented); one behind a login, where
`describesSamePage` must refuse the repository's reading rather than describe the login page; and one
whose `ld+json` is only an `Organization` and a `BreadcrumbList`, where the publisher must not become
the author. Filter the network tab on `/generate` and `/suggestions` — both stay empty for the whole
flow, which is what `aiSuggestionRequests` returning `[]` for a `'page'` origin is asserted for in
`util/mds-suggestions.spec.ts`.

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

Since nothing about the flow is configurable, the SSO login is only offered where the **repository**
publishes an authorization server at `<Repository>/.well-known/oauth-authorization-server` (RFC
8414). So the question is not only which provider to use but how to get the repository to name it:
the document is fetched from that address and every endpoint is read out of it (see
[ARCHITECTURE.md § The OAuth flow](ARCHITECTURE.md#the-oauth-flow)).

Two ways to get there, both of them local:

1. **edu-sharing's own authorization server** — `security.authentication.oauth2.enabled` plus a
   client `browser-plugin` in its configuration, which is what makes that well-known path answer.
   The client has to be registered as a public one (`clientAuthenticationMethod: "none"`, and
   `requireProofKey: true` so a flow without a challenge is refused rather than allowed); the sample
   configuration ships `client_secret_basic`, which a browser extension cannot use. This is the
   shape the feature is for, and it is a change to your repository, not to this repo.
2. **A metadata document in front of another provider** — write the JSON yourself at that path on the
   repository's host and put a provider's endpoints in it. This is what makes a Keycloak container
   testable at all now, and it is the cheaper of the two:

   ```json
   {
     "issuer": "http://localhost:8080/realms/edu-sharing",
     "authorization_endpoint": "http://localhost:8080/realms/edu-sharing/protocol/openid-connect/auth",
     "token_endpoint": "http://localhost:8080/realms/edu-sharing/protocol/openid-connect/token",
     "revocation_endpoint": "http://localhost:8080/realms/edu-sharing/protocol/openid-connect/revoke",
     "end_session_endpoint": "http://localhost:8080/realms/edu-sharing/protocol/openid-connect/logout",
     "userinfo_endpoint": "http://localhost:8080/realms/edu-sharing/protocol/openid-connect/userinfo",
     "scopes_supported": ["openid", "profile", "email", "offline_access"]
   }
   ```

   Only `authorization_endpoint` and `token_endpoint` are required — a document without them is
   refused as `OAUTH_DISCOVERY_INCOMPLETE`. `revocation_endpoint` and `end_session_endpoint` are what
   make *Abmelden* do more than forget locally, `userinfo_endpoint` is what lets a stored access token
   be held against the provider's own session — the second of the two ways the silent resume can
   check one, beside a refresh, and the only one left where the server issues no refresh token — and
   `scopes_supported` is what lets the settings name a scope the server does not define. Worth
   including both: a document that names neither leaves the panel unable to resume at all, which is
   its own thing to test (see [OAUTH-SESSION-LIFETIME.md](OAUTH-SESSION-LIFETIME.md)). Note that this only exercises the panel's half: the repository
   will still refuse the access token unless it trusts that issuer
   (`security.authentication.oauth2.trustedIssuers`).

Whichever provider stands behind it has to (1) register `browser-plugin` as a client whose token
endpoint takes no secret, because a public client cannot keep one, and (2) accept the redirect address
this browser hands out (below). That rules out some of the obvious candidates:

| Provider | Usable | Why |
| --- | --- | --- |
| Keycloak (local) | yes | Public client with `Client authentication` off, PKCE `S256`, and both a `revocation_endpoint` and an `end_session_endpoint`, so *Abmelden* is exercised in full. Also the shape edu-sharing federates in, so `oauthEntries` → `kc_idp_hint` matches |
| GitLab.com | yes | A non-confidential application does PKCE without a secret. Note its scopes: Doorkeeper defines no `offline_access`, which is one reason the panel does not ask for it |
| Microsoft Entra ID, Auth0, Okta | yes | Their SPA/native client types are secret-less and PKCE-only |
| Google | **no** | The token endpoint requires `client_secret` for every client type |
| GitHub | **no** | No OIDC endpoints of this shape, and the token endpoint requires the client secret |
| Hosted playgrounds and demo servers (`oauth.net/playground`, …) | mostly **no** | Their clients are registered against *their own* redirect URIs, and a browser extension's address is per-installation, so the code never comes back. `demo.duendesoftware.com` is the exception — its `interactive.public` client accepts any well-formed redirect address and needs no registration at all, credentials `alice/alice` — but the client id is theirs, not `browser-plugin`, so it only fits with the client name changed in `APP_CONFIG.oauth` |

### Keycloak in one container

```bash
docker run --rm -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.0 start-dev
```

On Keycloak 24/25 the variables are `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`; pick another host
port if 8080 is taken. Then in the admin console at `http://localhost:8080`:

1. **Realm** → *Create realm* → name it `edu-sharing`.
2. **Clients** → *Create client* → Client ID `browser-plugin`, the name the panel signs in under. On
   the next step leave **Client authentication off** — that is what makes it a public client — with
   *Standard flow* ticked and *Direct access grants* unticked.
3. On the client's **Advanced** tab set *Proof Key for Code Exchange Code Challenge Method* to
   `S256`, so the realm refuses a flow that omits the challenge instead of quietly allowing it.
4. **Valid redirect URIs** — see below; leave the rest of the client alone.
5. **Users** → *Create user*, then its *Credentials* tab → set a password, *Temporary* off.

`http://localhost` is reachable because the manifest declares `http://*/*` and the CSP names `http:`;
nothing has to be served over TLS for a local run. Where the repository runs in a container too, the
address has to resolve the same from the browser *and* from that container — `localhost` does not, so
use the compose network's gateway address for the endpoints in the document above.

### Which redirect URI to register

The address cannot be guessed — the browser mints it per installation — so the panel reports it:
**Einstellungen** (topbar) **→ SSO-Anmeldung** (click the heading to unfold it) **→** the highlighted
box beginning *„Diese Adresse beim Client im Provider hinterlegen"*. It appears whatever the
repository answered, so it can be read before anything is set up. Paste that value into Keycloak's
*Valid redirect URIs*.

Chrome and Edge report `https://<extension-id>.chromiumapp.org/`, Firefox a per-profile
`https://<uuid>.extensions.allizom.org/`, and Safari — which has no `identity` API to hand one out —
uses `<Repository>/oauth/extension-callback`. Each is different, so testing all three means
registering all three, and Firefox's changes when the profile does. The Safari address needs to serve
nothing: the flow matches on it and closes the tab before the load finishes. Should the request reach
that server after all, the authorization code in it is useless on its own — single-use and bound to a
PKCE verifier that never leaves the extension.

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
   repository (a dot marks the icon until applied). Under the field the edu-sharing version the
   repository reports must be named (`GET /_about`); against a repository of another major version a
   notice must say that it is unsupported, and every screen embedding one of the repository's own
   elements must then report the version instead of loading the `edu/` bundle
   ([WEB-COMPONENTS.md § Which repository the edu bundle fits](WEB-COMPONENTS.md#which-repository-the-edu-bundle-fits)).
3. **WLO abschalten**: against a repository that sets `browserExtensionCustomWebComponent`, untick
   *Einstellungen* → *Entwickler-Optionen* → **WLO-Funktionen verwenden** and leave the screen — the
   panel must lose the WLO palette, ask for a login, and offer neither *Prüfprozess auswählen* nor the
   *Qualität* tab nor Boerdi; the metadata screen must show the MDS editor. Tick it again and all of
   it must come back without reloading the extension. Everything below is walked with it ticked.
4. **Login**: required for everything except *Einstellungen*. Enter staging credentials → the session
   bar flips to "Angemeldet: …" and the login option disappears while the rest appear. If the
   repository URL was changed, login is blocked until it is applied in *Einstellungen*.
5. **SSO-Anmeldung** (needs a repository that publishes an authorization server — see
   [§ An identity provider to test the SSO login against](#an-identity-provider-to-test-the-sso-login-against)):
   register the address *Einstellungen* → *SSO-Anmeldung* reports with the client at the provider,
   then open the login card. It must now show **only** the SSO button — no username, no password, no
   *Passwort vergessen?* — and *Einstellungen* → *SSO-Anmeldung* must say which server was found. The
   provider's pages must open (a `launchWebAuthFlow` window on Chrome, Edge and Firefox; a tab that
   closes itself on Safari), and the session bar must flip to "Angemeldet: …" afterwards. Point the
   panel at a repository that publishes nothing there and the card must be the credential form alone
   again, with no error anywhere. *Abmelden* must end the session for good: with an
   `end_session_endpoint` in the document the next attempt must ask for credentials again rather than
   sign back in from the provider's cookie — that is the case to watch, since it is the one that
   silently does nothing when the endpoint is missing. Closing the provider's window instead must
   leave the login card exactly as it was, with no error on it. **Untested on Safari**, see
   [TROUBLESHOOTING.md § Browser-specific](TROUBLESHOOTING.md#browser-specific).
6. **Abmelden gegen eine Repository-Logout-Policy** (needs a repository whose client config carries a
   `logout` block — see
   [ARCHITECTURE.md § Logging out of the repository](ARCHITECTURE.md#logging-out-of-the-repository)):
   *Abmelden* must leave the page the panel is docked in exactly where it was, and open the logout
   address in a **window** of its own that stays put until you close it — a docked page that navigates
   away, or a window that vanishes before the page has shown anything, is the failure to watch for.
   With `ajax: true` no window must appear at all unless the request is refused; check the console for
   the fallback. With `next` set, that page must open in a tab beside the docked one while the panel
   shows the login card. Against a repository that publishes no `logout` block, *Abmelden* must do
   what it always did. In every case the check that matters is what happens **next**: navigate the
   docked tab to another page, so the panel is rebuilt, and it must still show the login card. A panel
   that comes back signed in means the session cookie survived, or the worker's token store did.
7. **Sitzungsende**: with a session open, leave the panel untouched past the repository's
   `sessionTimeout` (shorten it on a test instance to make this bearable). The session bar must count
   the last five minutes down (*Angemeldet · 04:31*), and when the time is up the panel must fall back
   to the login card naming inactivity as the reason. Then navigate the docked tab, so the panel is
   rebuilt: it must still show the login card. The stored tokens are dropped with a timed-out session
   precisely so the boot cannot put it back.
8. **Abmelden außerhalb des Panels**: sign in through the provider, then log out in edu-sharing's own
   web UI *and* at the provider, leaving the panel alone. Navigate the docked tab so the panel is
   rebuilt: it must show the login card. It asks the provider before resuming from its own store — a
   refresh where the server issues refresh tokens, else the userinfo endpoint — so a panel that comes
   back signed in means the provider still answers for that session. The reverse — a login card where
   the provider *should* still answer — is worth telling apart from a working refusal: check the
   worker's console, since a refresh that the token endpoint never served is reported there in the
   same words as a spent one (see [OAUTH-SESSION-LIFETIME.md](OAUTH-SESSION-LIFETIME.md)), and check
   whether the document names a `userinfo_endpoint` at all
   (`<Repository>/.well-known/oauth-authorization-server`).
9. **Erschließen + speichern**: *Inhalt erschließen* on a content page → the metadata screen shows
   `fields_extracted / fields_total` and loads the MDS editor with the generated metadata. Edit, then
   the footer's **Speichern** → a node is created in your inbox and the preview opens, and the flow's
   steps become reachable for that content.
10. **Metadaten anreichern** (OnlyOffice): open a document in the OnlyOffice editor with the
   edu-sharing plugin active, open the panel → the option appears and names the detected document.
   The footer's **Metadaten anreichern** reads the document and lands on the metadata screen with the
   generated metadata, the menu naming the document under *Inhalt erkannt*. **Speichern** must update
   **that** node — check in the repository that the document's metadata changed, that its
   name/extension is unchanged, and that no new node appeared in the inbox. With the page-side plugin
   switched off (*Plugins im Hintergrund*) the screen must report the timeout instead of hanging.
11. **Vorschau → Sammlungen**: from the preview, *Sammlung zuordnen* → pick a collection and confirm
   with *In Sammlung einfügen*; the screen lists what was added.
12. **An Nostr Relay weiterleiten**: the step is reached in the base version too — against a repository
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

13. **An Nostr Relay senden** (Inhaltsoptionen, between *Inhalt teilen* and *Interaktionen anzeigen*):
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
14. **Verlauf**: every *saved* node is listed (nothing is recorded until you save); entries expand to
   show their fields and offer *In Vorschau öffnen*, which reloads the node from the repository;
   *Leeren* clears the list.

## Where errors show up

The embedded elements run in the **sidebar document**, not in a frame of their own, so their failures
appear in the sidebar frame's console — select that frame in DevTools. If an embedded element stays
blank, look there for CSP or repository-CORS errors first.

Every log the extension writes itself carries the prefix `[edu-sharing][<station>]`. The background
worker logs to the extension's own console (`chrome://extensions` → *service worker*,
`about:debugging` → *Inspect*).
