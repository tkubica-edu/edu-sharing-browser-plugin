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

Twenty-one specs with 420 `it()` blocks cover eighteen of the panel's 36 services, two of its util
modules and the contracts with the extension around it. `npm run test:coverage` reports 38.8 % of
statements and 34.2 % of functions over its `coverageInclude` (`src/app/services/**` and
`src/app/util/**`). Everything outside that scope — components, `model/`, the pipe, the build harness
— has no automated test of any kind and is not even measured, and the extension's plain-JS parts are
pinned only at their boundary with the panel, never run.

| Area | Files | Covered | Kind of test it needs |
| --- | --- | --- | --- |
| `app-src/src/app/services/` | 36 | 18 services, 377 tests | Service spec (TestBed + fakes) |
| `app-src/src/app/util/` | 26 | `bundle-theme.ts`, `amb-event.ts`, 26 tests | Pure-function spec |
| `app-src/src/app/model/` | 4 | none | Pure-function spec (`navigation.ts` only; the rest is types) |
| `app-src/src/app/features/`, `template/`, `shared/`, `pipes/` | 46 | none | Component spec, and one pure-function spec for the pipe |
| `background/`, `content/` | 3 | the shared literals, 17 assertions | Boundary contract spec |
| `scripts/*.mjs` | 3 | none | Build-harness spec |

The ten largest uncovered files, by uncovered lines, are `services/curation.service.ts` (441 of
446), `services/editorial-groups.service.ts` (118), `util/quality-check-request.ts` (110),
`services/quality-judge.service.ts` (100), `services/collection-recommendation.service.ts` (82),
`services/metadata-agent.service.ts` (77), `services/web-component-bundle.service.ts` (73),
`services/onlyoffice-document.service.ts` (66), `services/content-suggestions.service.ts` (65) and
`util/chat-overrides.ts` (56).

## The five kinds of test

### 1. Pure-function specs — no TestBed, no fakes

`app-src/src/app/util/` is 24 modules and 3504 lines of functions over plain objects: no
`@angular/*` import, no injectable, nothing that runs at import time. A spec imports the function
and asserts on its return value; there is no setup at all. That makes this the cheapest coverage in
the repo and the reason to start here.

The largest single target is `util/quality-check-request.ts` (652 lines, nothing covered): it builds
every instruction and schema the KI check sends, through `criteriaOf`, `originOf`, `proofreadOf`,
`enrichmentOf`, `qualityInstructionOf`, `verdictsOf` and `knockoutSatisfied`. Its output is long
text, so the assertion that fits it is a golden file — one recorded dump per branch, diffed on
change — rather than a `toContain` per sentence. `util/agent-payload.ts`, `util/agent-fields.ts`,
`util/mds-values.ts`, `util/mds-node.ts`, `util/mds-suggestions.ts`, `util/curation-node.ts`,
`util/quality-criteria-values.ts`, `util/quality-schemes.ts`, `util/ai-schemas.ts`,
`util/page-context.ts`, `util/page-address.ts`, `util/repository-links.ts` and `util/errors.ts` are
ordinary value-in/value-out modules and need nothing but examples.

Three util modules patch a global in an `install*` call — `bundle-requests.ts` (`XMLHttpRequest`),
`bundle-windows.ts` (`window.open`), `bundle-language.ts` (`XMLHttpRequest`). Their pure halves
(`isDraftNodeUrl`, `repositoryWindowUrl`) are worth a spec on their own; the patch itself is a jsdom
test that has to restore the global, and `installDraftRequestGuard` additionally holds a
module-level `patched` flag that makes a second install a no-op — which is what the spec should pin.

Outside `util/`, the same kind covers `model/navigation.ts` — `SECTIONS` is a table of `visible`,
`enabled`, `disabledHint` and `requiresSession` predicates over a `Conditions` snapshot, and
`sectionText` reads it; a spec feeds it conditions and asserts which sections answer. `config.ts`
contributes `toApiRootUrl`, `toAgentProxyUrl` and `toTopicAssistantUrl` (URL derivation from the
configured repository), and `pipes/authority-name.pipe.ts` a six-branch name cascade in one
`transform`.

The glob is no longer in the way: the `test` target's `include` is `src/**/*.spec.ts`, so a spec
placed next to any of these files is executed. `util/bundle-theme.spec.ts` is the first of this kind
and is the pattern to follow for the other two `install*` modules — it installs the patch once (the
module-level flag it shares with production makes a second install a no-op for the patch itself) and
asserts on what the patched global answers.

### 2. Service specs — TestBed with a fake per dependency

The established kind, seventeen of them in place. What is left splits by what a service reaches for,
and the cost per service follows that, not its size:

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
  the shell listens at. `metadata-agent-api.service.ts` is 14 lines and one `computed`, and
  `node-write.service.spec.ts` uses the real one already; a spec of its own would only restate the
  constant — with that, this round is worked off.
- **A `fetch` of their own.** `content-judge.service.ts` and `metadata-agent.service.ts` go out
  through `fetchJson` in `util/json-api.ts` and a direct `fetch` respectively;
  `quality-judge.service.ts` does so transitively through both judges. The pattern is
  `metalookup.service.spec.ts`: re-stub the global in the spec's own `beforeEach`, which runs after
  `no-network.setup.ts` and wins. Their pure parts — `ContentJudgeService.requestBody`,
  `judgeableText`, `MetadataAgentService.parse` — are kind 1 and can be covered before the rest.
- **`ngx-edu-sharing-api` behind Observables.** `repository-node.service.ts`,
  `material-upload.service.ts`, `node-connector.service.ts` and `editorial-groups.service.ts` talk
  to the repository's `NodeService`, `CollectionService`, `ConnectorService` and `ConfigService`,
  for which no fake exists yet — only `fakeAuthentication`, `fakeUserApi` and `fakeClientUtils` are
  written. Either add fakes in the same style or answer through `HttpTestingController`, which
  `test-providers.ts` already provides. Fakes are the better fit: they keep the assertion on the
  call, not on a URL.
- **Timers and messaging.** `session-resume.service.ts` persists from a constructor `effect()` and
  reads `Date.now()`; `onlyoffice-document.service.ts` runs a request/response exchange with
  timeouts; `browser-extension.service.ts` is the `browser.*` and `postMessage` seam itself, with
  retry back-off. All three need `vi.useFakeTimers()` plus `TestBed.tick()`, which
  `page-recognition.service.spec.ts` and `history.service.spec.ts` already demonstrate.
- **`curation.service.ts` — 1595 lines, nine injected services, some 35 public methods and about 20
  signals.** The panel's state hub, and the one service to split rather than cover in one spec: one
  file per method group (the extraction run, `createContent`/`save`, `saveCollected` and the
  collection assignment, the quality reports, `adopt*`/`openNode`). It needs the largest fake set of
  anything here, which is the argument for doing it after the fakes above exist rather than before.

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
| 1 | `util/**` and `model/navigation.ts`, `config.ts`, the pipe | No new infrastructure beyond the `include` glob; 3504 lines of pure logic, `quality-check-request.ts` first |
| ~~2~~ | ~~The services with no outbound call~~ Done: `action-bar`, `navigation`, `node-write`, `chat-skill`, `chat-style`, `debug`; `metadata-agent-api` is covered through the `node-write` spec | Existing fakes plus two new ones; the largest logic gain per fake written |
| ~~3~~ | ~~The boundary invariant specs (kind 4, first half)~~ Done: `src/boundary/extension-contract.spec.ts` | No refactor, and one of them already named a broken route — `analyze.url`, fixed with it |
| 4 | The judges and the repository adapters: `content-judge`, `metadata-agent`, `quality-judge`, `repository-node`, `material-upload`, `node-connector`, `editorial-groups`, `collection-recommendation` | Needs the `ngx-edu-sharing-api` fakes; everything after this depends on them |
| 5 | `curation.service.ts`, split by method group, then `session-resume`, `onlyoffice-document`, `browser-extension`, `context-refresh`, `content-flow`, `content-suggestions` | The fake set from rounds 2 and 4 is what makes these affordable |
| 6 | Component specs for the seven candidates; the build harness; the exported-function half of the boundary | Each needs a decision or a change to shipped code first |

## Preconditions

- ~~**Widen the test glob.**~~ Done: `include` in the `test` target of `app-src/angular.json` is
  `src/**/*.spec.ts` — widened past `src/app` for the boundary spec, which is about no service.
  `coverageInclude` is `services/**` plus `util/**` and grows the same way —
  a round that covers `model/`, `pipes/` or a component has to extend it, or the new specs' subject
  is reported as uncovered.
- **Fakes to add** in `app-src/src/testing/fakes/`, in the established shape (a `fakeX()` factory
  returning the fake and its knobs, checked with `satisfies Partial<TheRealService>`).
  ~~`NavigationService` and `PageRecognitionService`~~ are written; still to come, for rounds 4 and 5,
  are `MetadataAgentService`, `RepositoryNodeService`, `NodeWriteService`, `MetalookupService`,
  `ContentJudgeService`, `QualityJudgeService`, `OnlyOfficeDocumentService` and the library's
  `NodeService`, `CollectionService`, `ConnectorService` and `ConfigService`. `ConditionsService`,
  `BusyService`, `KeywordRankingService`, `OptionIconService` and `MetadataAgentApiService` are cheap
  enough to use for real, as `navigation.service.spec.ts` does with the first two: both are
  derivations over fakes that exist, and faking them would move the registry's own rules into the
  spec.
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
