# Automated tests — what to cover next

Which parts of the code are covered today, which kind of test each uncovered part needs, and in what
order. Running the tests, what the harness in `app-src/src/testing/` provides and the rules a spec
has to obey is [TESTING.md § Unit tests](TESTING.md#unit-tests) — that file describes the tests that
exist, this one names the ones that do not yet. It shrinks as it is worked off.

- [Where the coverage stands](#where-the-coverage-stands)
- [The five kinds of test](#the-five-kinds-of-test)
- [The order to work in](#the-order-to-work-in)
- [Preconditions](#preconditions)
- [What stays manual](#what-stays-manual)

---

## Where the coverage stands

Eighty-nine specs with 1947 `it()` blocks cover **43 of the panel's 44 services**, **all 37** of its util
modules, the navigation registry, the config's URL derivation, the one pipe, and the contracts with the
extension around it. `npm run test:coverage` reports 96.0 % of statements and 95.5 % of functions over
its `coverageInclude` (`src/app/services/**`, `src/app/util/**`, `model/navigation.ts`, `pipes/**` and
`config.ts`). What is outside that scope — the components, the rest of `model/`, the build harness — has
no automated test of any kind and is not even measured, and the extension's plain-JS parts are pinned
only at their boundary with the panel, never run.

**No test reaches the network, and that is checked rather than assumed.** The whole suite passes inside
a network namespace with no interfaces (`unshare -rn npx ng test`), which is the proof that neither
ContentJudge, MetalookUp, the metadata agent, the topic assistant, the nostr relay nor a repository is
spoken to. `no-network.setup.ts` is what keeps it that way as specs are added — see
[TESTING.md § Unit tests](TESTING.md#unit-tests) for its four channels.

| Area | Files | Lines covered | Kind of test it needs |
| --- | --- | --- | --- |
| `app-src/src/app/services/` | 44 | 96 % | Service spec (TestBed + fakes) |
| `app-src/src/app/util/` | 37 | 99 % | Pure-function spec |
| `app-src/src/app/model/navigation.ts`, `pipes/`, `config.ts` | 3 | 100 % | Pure-function spec |
| `app-src/src/app/features/`, `template/`, `shared/` | 47 | none | Component spec |
| `background/`, `content/` | 3 | the shared literals, 17 assertions | Boundary contract spec |
| `scripts/*.mjs` | 3 | none | Build-harness spec |

What is left inside the measured scope is 122 lines, and 80 of them are `web-component-bundle.service.ts`,
which is deliberately out of scope (see below). Of the rest, 18 are in `curation.service.ts` and the other
24 are one- and two-line `catch` branches spread over seventeen files — each reachable only by making a
library call fail in a way its fake has no knob for. Then the components.

## The five kinds of test

### ~~1. Pure-function specs — no TestBed, no fakes~~

Worked off. All 37 modules under `app-src/src/app/util/` have a spec, as do `model/navigation.ts`,
`config.ts` and `pipes/authority-name.pipe.ts`. What the round settled, for the rounds after it:

- **A long text is pinned as a golden file, not sentence by sentence.** `quality-check-request.ts`
  builds the check's five tasks, and their wording *is* the behaviour — so
  `quality-check-request.spec.ts` renders every task over every branch that changes it (three states of
  the surroundings × five states of the content, 39 recorded sections) into
  `__snapshots__/quality-check-request.txt` through `toMatchFileSnapshot`. A change to any of it shows
  up as a diff, and `npm --prefix app-src run test -- -u` records the new wording once it is meant.
  What a `toContain` would have pinned is pinned properly next door: the couplings the texts carry —
  the chip labels of `AI_REPLIES`, the verdict glyphs `chat-overrides.ts` colours, the footer label
  from `action-bar.service.ts` — are assertions in `ai-prompts.spec.ts`, one of which drives
  `installChatOverrides` over each glyph the task asks for rather than restating the glyph list.
- **A module whose subject is a global says how it puts the global back, and does not rely on
  `vi.unstubAllGlobals()` to do it.** `bundle-requests.spec.ts` and `bundle-language.spec.ts` replace
  the `XMLHttpRequest.prototype` members *before* installing the patch, so the patch's own captured
  "native" is a spy and nothing dials out; `bundle-windows.spec.ts` does the same for `window.open` and
  gives the document a `<base href="chrome-extension://…">` so the bundle's URLs resolve as they do in
  the extension. Each of those installs is idempotent by a module-level flag it shares with production,
  so it happens once per spec file. `chat-session.spec.ts` denies storage by spying
  `Storage.prototype` and restoring in a `finally` — a `vi.stubGlobal('localStorage', …)` there was
  flaky, since a leak past the restore breaks every test after it rather than that one.
- **A module that captures a global at load has to decide when that load happens.** `system-theme.ts`
  takes its `matchMedia` reference at module load on purpose, and a worker runs several spec files
  against one jsdom — so which reference an already-imported instance holds depends on which file
  imported it first. `system-theme.spec.ts` calls `vi.resetModules()` and `await import()` per test,
  which is both deterministic and the honest way to exercise the capture.
- **`nostr-relay.ts` is driven frame by frame.** Its spec's fake socket does nothing until the test says
  so, which is what lets every ending of the exchange be reached deliberately: an answer, a `CLOSED`, a
  `NOTICE`, a non-JSON frame, a silence past the timeout, a hang-up with and without a reason.

### 2. Service specs — TestBed with a fake per dependency

The established kind, 34 of them in place. What is left splits by what a service reaches for, and the
cost per service follows that, not its size:

- ~~**No outbound call at all, only other services' signals.**~~ Done: `action-bar.service.ts`,
  `navigation.service.ts` and `node-write.service.ts` are covered, and the fakes they needed
  (`fakeNavigation()`, `fakePageRecognition()`, `saveNode` on `fakeBrowserExtension()`) exist for the
  rounds below. Two things the three specs settled that the ones after them can follow: a fake of a
  *state* service carries writable signals for what its dependents read and states the step directly
  rather than deriving it (see `fakeNavigation().at()`), and a footer action is asserted by running it
  and reading the move it made on the fake, not by matching its label.
- ~~**Extension storage only.**~~ Done: `chat-skill.service.ts`, `chat-style.service.ts` and
  `debug.service.ts` are covered through `fakeBrowserExtension()` alone, in the shape
  `dev-mode.service.spec.ts` set. Two of the three are a persisted switch and a default, so what the
  specs pin is the *default* and what is done with a stored value that no longer fits it —
  `ChatSkillService` validates one and `ChatStyleService` does not. `DebugService` is the one with
  behaviour beyond that: it stands in for the host-side plugin, so its spec drives the simulated
  events with `vi.useFakeTimers()` and asserts on a spy over `window.postMessage`, which is the seam
  the shell listens at.
- ~~**A `fetch` of their own, and the repository adapters.**~~ Done: `content-judge`,
  `metadata-agent`, `quality-judge`, `collection-recommendation`, `repository-node`,
  `material-upload`, `node-connector`, `editorial-groups`, `suggestion`, `session-resume`,
  `context-refresh` and `metadata-agent-api`. What these settled:
  - **A service with its own `fetch` re-stubs the global in its own `beforeEach`**, which runs after
    `no-network.setup.ts` and wins — and the stub must be a `mockImplementation` returning a *fresh*
    `Response` per call, since a body can be read only once and these services make two requests
    (`ContentJudgeService` asks `/health/` before every `/evaluate/`).
  - **The `ngx-edu-sharing-api` fakes exist now**, in `edu-sharing-api.fake.ts`: `fakeNodeApi`,
    `fakeNodeApiUnwrapped`, `fakeCollections`, `fakeConnectors`, `fakeApiConfiguration`, plus
    `getUserPreferences` on `fakeUserApi` and `observeVariables` on `fakeConfig`. Each names what the
    repository *does* rather than what it answers with — `refuses(method)`, `refusesProperty(name)`,
    `holds(node, inside)` — which is what lets a spec reach the retry paths (`writeExtendedData`
    field by field, `SuggestionService.propose` entry by entry) without matching a URL.
  - **A root-provided service is one instance per `TestBed`.** A spec that wants a second one with
    different state needs a second `it`, not a second `TestBed.inject` — two tests here passed for
    the wrong reason before that was noticed.
  - `fakeContentJudge`, `fakeMetalookup`, `fakeRecommendations` and `fakePageDerivation` are written
    for the services above and are what makes `curation.service.ts` affordable.
- ~~**Timers and messaging.**~~ Done: `browser-extension.service.ts` and `onlyoffice-document.service.ts`.
  The one that needed a new seam is the first, because its subject *is* the extension API that
  `extension-globals.setup.ts` exists to refuse: the polyfill reads `globalThis.browser` once, at import,
  and re-exports it unchanged, so the service holds that proxy for the life of the worker and neither
  reassigning the global nor `vi.resetModules()` reaches it — the builder's chunks are not the Vite module
  graph. `useExtensionApi()` swaps what the proxy answers out of instead, which is the only way in a spec
  still has. What the two settled beyond that: the retry back-off is driven with
  `await vi.advanceTimersByTimeAsync(ms)`, and a call that rejects has to have its outcome taken hold of
  **before** the clock is moved, or the rejection lands while nothing is waiting on it and the runner
  reports an unhandled rejection. `onlyoffice-document.service.spec.ts` correlates its answers by reading
  the `requestId` off the spy's last call, which is what lets two requests be answered out of order.
- ~~**`curation.service.ts` — 1686 lines, eleven injected services, some 35 public methods and about 20
  signals.**~~ Done, split by method group into three files, which is the shape to follow for any
  service of this size:
  - `curation.service.state.spec.ts` (54) — the derived signals the whole panel reads it through:
    `editorMetadata` and its three-layer precedence (findings under the node's properties under what a
    step recorded), `contentPreview`'s five-way ranking, `agentEditWindowClosed`, `filedCollections`,
    the draft and editor nodes.
  - `curation.service.save.spec.ts` (35) — the write: which of the two routes a save takes and why,
    recorded values going underneath the editor's, the licence written only on the describing step, the
    agent route's three partial-success reports, and the dev mode's unwritten save.
  - `curation.service.reopen.spec.ts` (65) — taking a content back up: `openFromHistory`,
    `adoptDetectedNode`/`adoptDetectedNodeId`/`adoptRememberedNode`, `resumeNode`, `openNode`,
    `analyze`, `assignToCollections`, `confirmQuality` and `applyDraftValues`. The thread through all
    of it is the guest session, whose node the agent wrote and which may therefore not read it: every
    one of those paths has a branch that stands the history entry in for the node, and each is pinned
    both ways round.
- ~~Left with it: `content-flow`, `content-suggestions` and `mds-ai-suggestion`, which read the
  curation's state.~~ Done. `content-flow.service.spec.ts` uses the real `ConditionsService`, so the
  „already open" branch is decided by the page's own address rather than by a flag a fake sets;
  `content-suggestions.service.spec.ts` fakes `KeywordRankingService.rank` with a reordering of the
  spec's choosing, which is what proves the cut to eight is made *after* the ranking rather than before
  it; `mds-ai-suggestion.service.spec.ts` builds a real `MdsDefinition` and lets `aiConfigFields` and
  `aiConfigBreakdown` read it, since both are covered by their own specs already.

One service is deliberately left out: `web-component-bundle.service.ts` fetches a bundle's
`index.html`, injects `script` and `link` elements into `document.head` and then polls
`customElements`. A jsdom spec would assert that the elements were appended, which is not the thing
that can break — whether the bundle boots under the extension CSP is a browser question and stays in
the manual checklist.

### 3. Component specs — `TestBed.createComponent` in jsdom

New territory: none of the 46 components has a spec, and nothing in the harness is set up for one.
Most of them are template glue over the services and are not worth a spec — the logic they show is
already covered where it lives. What earns one is the handful that hold state of their own:

- `features/quality/ai-quality-screen/ai-quality-screen.component.ts` (681 lines) — a step machine
  (`CheckStep`, `goTo`, `take*`, `mayLeave`, `turnsInStep`, `quickReplies`) plus the pure
  `announced()` and `merge()` at the end of the file, which are kind 1 today.
- `features/quality/quality-criteria/quality-criteria.component.ts` (517) — the verdict matrix:
  `isMet`, `isViolated`, `isDismissed`, `allKnockoutMet`, `checkState`, `setAllKnockout`.
- `features/quality/quality-check-alert/quality-check-alert.component.ts` (113) — a `linkedSignal`
  index that clamps and advances over the incoming violations, the kind of arithmetic that is off by
  one until pinned.
- `features/settings/settings-screen/settings-screen.component.ts` (257) — `changedPerSection` and
  some fifteen setters, each writing a persisted option.
- `features/content/content-options-screen/content-options-screen.component.ts` (176),
  `template/menu/menu.component.ts` (160) and
  `features/metadata/mds-preview-widget/mds-preview-widget.component.ts` (220) — each a table of
  entries filtered against a `Conditions` snapshot or a node.

Before the first one: decide whether these specs render (`createComponent` and assert on the DOM) or
only drive the class through `TestBed.inject`-style construction and assert on its signals. The
second is cheaper and covers the logic named above; the first is the only one that catches a
template that stopped binding. The recommendation is to render, because the components that are
worth testing at all are the ones whose template is the interesting half — but that decision belongs
in the round that writes the first spec, and it is the point at which the components that mount a
vendored web component (`mds-editor`, `wlo-canvas`, `ai-assistant-screen`) drop out:
`customElements` is not available for them and the bundle is not loadable in jsdom.

### 4. Boundary contract specs — where the sidebar meets the extension

`background/background.js` (654 lines), `content/panel-host.js` (374) and `content/content.js` (298)
are plain JavaScript, copied verbatim into every target by `scripts/build.mjs`. None of them exports
anything: `background.js` and `content.js` assign to `self` or run as an injected IIFE, so **no part
of them can be imported by a test as they stand**. `config.js` is the exception — it has
`module.exports`, though it also logs at import.

Two levels are worth having, and the cheap one first:

~~**Invariant specs over the literals.**~~ Done, in
`app-src/src/boundary/extension-contract.spec.ts`: 17 assertions over the pairs below, plus that the
two configs name one repository and derive the same metadata agent from it. It reads each plain-JS
file as text — none of them exports anything — and evaluates the two that are data behind a `self`
guard (`config.js`, `background/dev-fixtures.js`) in a sandbox, so what it compares is what the
worker really sees rather than what a regex believes about the formatting. The spec lives outside
`src/app`, which is what widened the `include` glob to `src/**/*.spec.ts`: it belongs to no service.

| Invariant | The two sides |
| --- | --- |
| Every action the panel sends is routed | `ALLOWED_ACTIONS` in `background/background.js` ⊇ the `action:` literals in `services/browser-extension.service.ts` |
| The worker's file list matches Firefox's | `importScripts` in `sw.js` == `background.scripts` in `manifest.firefox.json` |
| The panel element is found again | `PANEL_ELEMENT_ID` (`background.js`) == `PANEL_ID` (`content/panel-host.js`) |
| A page's text is cut to one length | `MAIN_CONTENT_MAX` (`content/content.js`) == `CONTENT_TEXT_MAX` (`util/page-context.ts`) |
| Every fixture the settings offer exists | `agentGenerate` keys in `background/dev-fixtures.js` == `GENERATE_FIXTURES` ids in `services/dev-mode.service.ts` |
| The dev-mode keys are one registry | the storage-key literals in `background.js` == `APP_CONFIG.storageKeys` |

The first row was not hypothetical, and the spec's first run said so:
`BrowserExtensionService.analyzeUrl` sends `analyze.url` and `background.js` has a
`case 'analyze.url'` for it, but the action was not in
`ALLOWED_ACTIONS` — so the listener returned before the `switch` and that case was unreachable, which
`MetadataAgentService.runForUrl` reported as `NO_RESPONSE` and `CurationService.runPendingExtraction`
swallowed. The action is in the set as of this round; the route it opens is the Erschließung of a page
the browser is not on. Both directions are asserted now, so an action allowed without a route fails
the same way.

**Behaviour specs after an export.** Beyond the literals, `background.js` holds pure logic worth
pinning — `agentBaseOf` (the URL allow-list and trailing-slash strip), `buildGenerateBody`,
`withPageStatedPictures`, `pictureFileOf`, `dataUrlToBlob`, and the privileged-scheme guard
(`/^(chrome|edge|about|chrome-extension|moz-extension|safari-web-extension):/`) that decides whether
a tab may be analyzed at all. `content/content.js` is DOM reading that jsdom answers exactly
(`extractLicenseInfo`, `extractStructuredData`, `extractBreadcrumbs`, and the fully pure
`buildFormattedText`), and `content/panel-host.js` routes the host-page events that
[content/HOST-EVENTS.md](content/HOST-EVENTS.md) specifies in prose — `clampWidth`,
`broadcastToFrames` and the `message` handler's table are the units. All of it needs the same
preparation: export the functions, keep the listener registration behind a guard so importing the
file registers nothing. That is a change to shipped extension code, so it is the last round, not the
first.

### 5. Build-harness specs — Node, no Angular

`scripts/build.mjs` and `scripts/version.mjs` both call `main()` at the bottom and export nothing,
so importing either runs a build or a version bump. With an `export` and an `import.meta.url ===
process.argv[1]` guard, three functions are worth a spec and cheap to write: `deepMerge` (how
`manifest.base.json` and a target overlay combine — objects recurse, arrays and scalars replace),
`isExcluded` (the POSIX prefix match behind `BUNDLE_EXCLUDES`, which is what keeps
`edu/assets/monaco` out of the package) and `setVersion` (the regex rewrite of the first top-level
`"version"`, which has to leave both files' formatting intact). `parseCli` calls `process.exit` on a
bad argument, which a spec would have to work around; returning an error instead is the smaller
change.

The file-system half — `assembleTarget`, `writeManifest`, `zipDir`, the watchers — is not worth
mocking. What it produces is checked by the CI `build` job and `web-ext lint` on every push already.

These specs do not belong to the sidebar's Vitest run: they test root-level ESM with no Angular in
sight. They want their own runner at the repo root and their own CI job, which is a second decision
to take in that round.

## The order to work in

Each round is worth landing on its own; nothing in a later one is a precondition for an earlier one.

| Round | What | Why here |
| --- | --- | --- |
| ~~1~~ | ~~`util/**` and `model/navigation.ts`, `config.ts`, the pipe~~ Done: all 37 util modules, the registry, the config's URL derivation and the pipe | No new infrastructure; the one thing it needed was a golden file for `quality-check-request.ts` and the `coverageInclude` entries for the three files outside `util/` |
| ~~2~~ | ~~The services with no outbound call~~ Done: `action-bar`, `navigation`, `node-write`, `chat-skill`, `chat-style`, `debug`; `metadata-agent-api` is covered through the `node-write` spec | Existing fakes plus two new ones; the largest logic gain per fake written |
| ~~3~~ | ~~The boundary invariant specs (kind 4, first half)~~ Done: `src/boundary/extension-contract.spec.ts` | No refactor, and one of them already named a broken route — `analyze.url`, fixed with it |
| ~~4~~ | ~~The judges and the repository adapters~~ Done, plus `suggestion`, `session-resume`, `context-refresh` and `metadata-agent-api` | The `ngx-edu-sharing-api` fakes were its point and now exist; everything after this builds on them |
| ~~5~~ | ~~`curation.service.ts`, then `browser-extension`, `onlyoffice-document`, `content-flow`, `content-suggestions`, `mds-ai-suggestion`~~ Done; every service but `web-component-bundle` now has a spec | `browser-extension.service.ts` was the one worth doing first — the seam fifteen services depend on, and the file where a bug would have been invisible everywhere else |
| 6 | Component specs for the seven candidates; the build harness; the exported-function half of the boundary | Each needs a decision or a change to shipped code first |

## Preconditions

- ~~**Widen the test glob.**~~ Done: `include` in the `test` target of `app-src/angular.json` is
  `src/**/*.spec.ts` — widened past `src/app` for the boundary spec, which is about no service.
  `coverageInclude` is `services/**` and `util/**` plus `model/navigation.ts`, `pipes/**` and
  `config.ts`, and it grows the same way — a round that covers a component has to extend it, or the
  new specs' subject is reported as uncovered.
- ~~**Fakes to add** in `app-src/src/testing/fakes/`.~~ Written, in the established shape (a `fakeX()`
  factory returning the fake and its knobs, checked with `satisfies Partial<TheRealService>`):
  `fakeNavigation`, `fakePageRecognition`, `fakePageDerivation`, `fakeContentJudge`, `fakeMetalookup`,
  `fakeRecommendations`, and the library's `fakeNodeApi`, `fakeNodeApiUnwrapped`, `fakeCollections`,
  `fakeConnectors` and `fakeApiConfiguration`. `fakeBrowserExtension` grew `analyzeActiveTab`,
  `analyzeUrl`, `readPage`, `extractPageData`, `getActiveTab`, `getOwnTabId` and the host-page messages
  (`insertNodes`, `requestDocumentContent`, `requestDocumentInfo`, `signalReady`, `closePanel`, with
  `standalone()` for a panel no page embeds); `fakeCuration` grew what the forwarding and the resume read
  and write, plus `previewNode` and its `hydrated()` knob; `fakeMetadataAgent` grew `generatesField()` and
  `refusesField()` for the single-field runs. `ConditionsService`, `BusyService`,
  `KeywordRankingService`, `OptionIconService` and `MetadataAgentApiService` are used for real, as
  `navigation.service.spec.ts` does with the first two: both are derivations over fakes that exist, and
  faking them would move the registry's own rules into the spec. A spec that uses the real
  `ConditionsService` has to provide `fakeAuth()` with it — the real `AuthService` behind it wants the
  `BOOT_ROOT_URL` token, which no `TestBed` here provides.
- **Exports and a main guard** in `scripts/build.mjs`, `scripts/version.mjs`,
  `background/background.js`, `content/content.js` and `content/panel-host.js` — round 6's
  precondition, and the one item on this list that changes code that ships.
- **A second runner** for the root-level `scripts/**` specs, plus the CI job that runs it. The
  sidebar's `test` job in `.github/workflows/build.yml` installs `app-src`'s lockfile alone and
  cannot host them.

## What stays manual

Nothing here replaces [TESTING.md § Manual test checklist](TESTING.md#manual-test-checklist).
Whether the vendored bundles boot under the extension CSP, whether the repository answers a
logged-in write, whether the panel docks and resizes on a real page, and whether the OnlyOffice
exchange completes are all questions about a real browser, a real repository or a real host page — a
jsdom spec that claimed to answer them would be asserting on its own fakes. Browser automation over
a loaded extension is not proposed: the plan above buys more per hour of work, and the manual
checklist is short enough to run.
