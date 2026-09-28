# Load & test

- [Unit tests](#unit-tests)
- [Load the extension](#load-the-extension)
- [Watch mode (rebuild on every change)](#watch-mode-rebuild-on-every-change)
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
produced, and the two under `src/boundary/`, which are about no service. They are the
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
zoneless makes the handler run synchronously, so nothing else is needed. A `[ngModel]` field is written
the same way through the event *its* accessor listens for — `input` for a text or number field,
`change` for a `select` — and a number field emits `null` for an emptied one, which is how
`settings-screen.component.spec.ts` reaches the guard that treats a half-typed field as no value at
all. `location.reload()` is not driven from any spec: jsdom does not implement it, so the screens that
offer it (`settings-screen`, `AuthService.applyRepositoryChange`) leave that one line to the manual
checklist. Two traps cost time here and
are worth knowing before the third spec: a `computed` that *calls* a spy does not re-evaluate when that
spy's return value changes, because no signal moved — a test wanting the other answer builds the
fixture with it from the start; and `mockReturnValue` outlives the test that set it, since `mockClear()`
only forgets the calls, so a spy shared across a file is re-stated with `mockReset()` plus
`mockImplementation` in `beforeEach`. The components that mount a vendored web component have no spec
and are excluded from the coverage figure by name.

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
uncovered: six services around it, and the components.

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

## Where errors show up

The embedded elements run in the **sidebar document**, not in a frame of their own, so their failures
appear in the sidebar frame's console — select that frame in DevTools. If an embedded element stays
blank, look there for CSP or repository-CORS errors first.

Every log the extension writes itself carries the prefix `[edu-sharing][<station>]`. The background
worker logs to the extension's own console (`chrome://extensions` → *service worker*,
`about:debugging` → *Inspect*).
