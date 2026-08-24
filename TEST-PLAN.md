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

Ten specs with 147 `it()` blocks cover ten of the panel's 34 services. `npm run test:coverage`
reports 19.6 % of statements and 13.5 % of functions over its `coverageInclude`
(`src/app/services/**` and `src/app/util/**`). Everything outside that scope — components, `model/`,
the pipe, the extension's plain-JS parts, the build harness — has no automated test of any kind and
is not even measured.

| Area | Files | Covered | Kind of test it needs |
| --- | --- | --- | --- |
| `app-src/src/app/services/` | 34 | 10 services, 147 tests | Service spec (TestBed + fakes) |
| `app-src/src/app/util/` | 22 | none, though measured | Pure-function spec |
| `app-src/src/app/model/` | 4 | none | Pure-function spec (`navigation.ts` only; the rest is types) |
| `app-src/src/app/features/`, `template/`, `shared/`, `pipes/` | 46 | none | Component spec, and one pure-function spec for the pipe |
| `background/`, `content/` | 3 | none | Boundary contract spec |
| `scripts/*.mjs` | 3 | none | Build-harness spec |

The ten largest uncovered files, by uncovered lines, are `services/curation.service.ts` (441 of
446), `services/navigation.service.ts` (157), `services/editorial-groups.service.ts` (118),
`util/quality-check-request.ts` (110), `services/quality-judge.service.ts` (100),
`services/collection-recommendation.service.ts` (82), `services/metadata-agent.service.ts` (77),
`services/action-bar.service.ts` (76), `services/web-component-bundle.service.ts` (73) and
`services/onlyoffice-document.service.ts` (66).

## The five kinds of test

### 1. Pure-function specs — no TestBed, no fakes

`app-src/src/app/util/` is 22 modules and 3306 lines of functions over plain objects: no
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

**`app-src/angular.json` restricts the run to `src/app/services/**/*.spec.ts`.** Until that glob is
widened, a spec placed next to any of these files is never executed — see
[Preconditions](#preconditions).

### 2. Service specs — TestBed with a fake per dependency

The established kind, ten of them in place. What is left splits by what a service reaches for, and
the cost per service follows that, not its size:

- **No outbound call at all, only other services' signals.** `action-bar.service.ts` (407 lines) is
  pure derivation of the footer's buttons, `navigation.service.ts` (502) a signal state machine over
  section, screen, trail and overlay. Both are the highest logic-per-fake ratio left in the folder
  and need only fakes for `NavigationService` and `PageRecognitionService` to exist.
  `node-write.service.ts` is request-body assembly (`toEnvelope`, the `write_extended_data` and
  workflow flags) behind a single `browserExtension.saveNode` call the existing fake already
  answers.
- **Extension storage only.** `chat-skill.service.ts`, `chat-style.service.ts` and
  `debug.service.ts` read and write settings through `BrowserExtensionService`, which
  `fakeBrowserExtension()` covers today — the same shape as the already-covered `DevModeService`.
  `metadata-agent-api.service.ts` is 14 lines and one `computed`.
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

**Invariant specs over the literals.** These need no refactor at all: a Node spec reads both files
and asserts they agree. Each pair below is a contract that is upheld by hand today and breaks
silently.

| Invariant | The two sides |
| --- | --- |
| Every action the panel sends is routed | `ALLOWED_ACTIONS` in `background/background.js` ⊇ the `action:` literals in `services/browser-extension.service.ts` |
| The worker's file list matches Firefox's | `importScripts` in `sw.js` == `background.scripts` in `manifest.firefox.json` |
| The panel element is found again | `PANEL_ELEMENT_ID` (`background.js`) == `PANEL_ID` (`content/panel-host.js`) |
| A page's text is cut to one length | `MAIN_CONTENT_MAX` (`content/content.js`) == `CONTENT_TEXT_MAX` (`util/page-context.ts`) |
| Every fixture the settings offer exists | `agentGenerate` keys in `background/dev-fixtures.js` == `GENERATE_FIXTURES` ids in `services/dev-mode.service.ts` |
| The dev-mode keys are one registry | the storage-key literals in `background.js` == `APP_CONFIG.storageKeys` |

The first row is not hypothetical. `BrowserExtensionService.analyzeUrl` sends `analyze.url`, and
`background.js` has a `case 'analyze.url'` for it — but `analyze.url` is not in `ALLOWED_ACTIONS`,
so the listener returns before the `switch` and that case is unreachable. Reading the callers,
`MetadataAgentService.runForUrl` then reports `NO_RESPONSE` and
`CurationService.runPendingExtraction` returns silently on it, which is why nothing says so out
loud. That is one assertion's worth of test standing between the contract and a route that cannot
work.

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
| 1 | `util/**` and `model/navigation.ts`, `config.ts`, the pipe | No new infrastructure beyond the `include` glob; 3306 lines of pure logic, `quality-check-request.ts` first |
| 2 | The services with no outbound call: `action-bar`, `navigation`, `node-write`, `chat-skill`, `chat-style`, `debug`, `metadata-agent-api` | Existing fakes plus two new ones; the largest logic gain per fake written |
| 3 | The boundary invariant specs (kind 4, first half) | No refactor, and one of them already names a broken route |
| 4 | The judges and the repository adapters: `content-judge`, `metadata-agent`, `quality-judge`, `repository-node`, `material-upload`, `node-connector`, `editorial-groups`, `collection-recommendation` | Needs the `ngx-edu-sharing-api` fakes; everything after this depends on them |
| 5 | `curation.service.ts`, split by method group, then `session-resume`, `onlyoffice-document`, `browser-extension`, `context-refresh`, `content-flow`, `content-suggestions` | The fake set from rounds 2 and 4 is what makes these affordable |
| 6 | Component specs for the seven candidates; the build harness; the exported-function half of the boundary | Each needs a decision or a change to shipped code first |

## Preconditions

- **Widen the test glob.** `include` in the `test` target of `app-src/angular.json` is
  `src/app/services/**/*.spec.ts`; rounds 1 and 6 need `src/app/**/*.spec.ts`. `coverageInclude` is
  already `services/**` plus `util/**` and grows the same way — leaving it behind would report the
  new specs' subject as uncovered.
- **Fakes to add** in `app-src/src/testing/fakes/`, in the established shape (a `fakeX()` factory
  returning the fake and its knobs, checked with `satisfies Partial<TheRealService>`):
  `NavigationService` and `PageRecognitionService` for round 2; `MetadataAgentService`,
  `RepositoryNodeService`, `NodeWriteService`, `MetalookupService`, `ContentJudgeService`,
  `QualityJudgeService`, `OnlyOfficeDocumentService` and the library's `NodeService`,
  `CollectionService`, `ConnectorService` and `ConfigService` for rounds 4 and 5.
  `ConditionsService`, `BusyService`, `KeywordRankingService`, `OptionIconService` and
  `MetadataAgentApiService` are cheap enough to use for real, as `page-recognition.service.spec.ts`
  already does with `ConditionsService`.
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
