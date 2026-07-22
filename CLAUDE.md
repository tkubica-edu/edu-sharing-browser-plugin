# CLAUDE.md — Externally customizable "Aktionen & Optionen" menu

Working context for the feature that lets **externally loaded code (a web component at a
backend-configured URL)** add/replace options in the sidebar's "Aktionen & Optionen" menu and
make login optional. Read this first when resuming.

> Full design + local-test plan: `/home/reuter/.claude/plans/we-target-to-make-idempotent-sutherland.md`

## Project layout (essentials)
- Angular 21, **zoneless** sidebar app under `app-src/` (bootstraps `bootstrapApplication`,
  `provideZonelessChangeDetection()`). Uses `ngx-edu-sharing-api` (v10).
- The sidebar is `chrome-extension://…/sidebar/index.html`, injected as an **iframe** into the
  host page by the content script `content/panel-host.js` → it is an **extension page** (CSP applies).
- Build: `scripts/build.mjs` runs `ng build` in `app-src`, copies shared dirs, deep-merges
  `manifest.base.json` + `manifest.<target>.json`, zips to `dist/<target>`.
  Root scripts: `npm run build:chrome|firefox|safari`, `build` (=all).
- The edu-sharing web-component bundle is loaded **locally** from `webcomponent/*` via
  `EduBundleService` (`app-src/src/app/services/edu-bundle.service.ts`) — the model we mirrored.

## What the feature does (confirmed decisions)
- Options are a **runtime registry** merging built-ins with contributions (add / **replace by id**).
- **Rendering supports both**: a contributed option's `view` is `{kind:'element', tag}` (custom
  element inline in the sidebar) or `{kind:'iframe', url}` (sandboxed remote iframe).
- **Contribution API = runtime JS registration**: extension exposes `window.eduSharingPlugin`
  (`registerOption`, `disableLoginRequirement`, `getContext`, `requestPageExtraction`, `insertNodes`).
- **Login optional**: contributed code can call `disableLoginRequirement()`; options can set
  `bypassLogin: true` so they show for guests.
- **First consumer**: the **metadata-agent-canvas** web component **replaces** the built-in
  `erschliessen` ("Inhalt erschließen") option, guest-visible.

## Hard constraint — MV3 CSP
`manifest.base.json` `extension_pages` keeps `script-src 'self'` → **remote `<script>` injection is
blocked in Chrome/Safari** (store policy). Consequences:
- **iframe mode** = store-safe (only `frame-src` relaxed; base now has `frame-src 'self' https:`).
- **element mode** (remote script injection) needs a `script-src` relaxation → only viable in
  **Firefox / enterprise builds**, done via a per-target `manifest.firefox.json` CSP override.

## Files (all committed changes are unstaged; nothing committed yet)
Created (`app-src/src/app/`):
- `services/options-registry.service.ts` — signal registry; `register()`, `get()`, `options` computed; `normalize()` applies `requiresLogin` unless `bypassLogin`.
- `services/additional-webcomponent.service.ts` — detection (ConfigService or static override) → reachability probe → install `window.eduSharingPlugin` → register contribution + `disableLoginRequirement()` up front → (element mode) inject bundle. **Has diagnostic `console.log('[edu-sharing][additional-wc] …')`.**
- `services/plugin-context.service.ts` — assembles `PluginContext`; `encoded()` = base64 for iframe `data` param (includes `url` alias for the metadata-agent contract).
- `components/extension-view-host.component.ts` — renders element/iframe view, passes context, routes results (`CANVAS_CLOSE`, node results, element events) into signal services, teardown in `OnDestroy`.
- `plugin/plugin-api.ts` — `EduSharingPluginApi`, `PluginOptionInput`, `PluginContext` types.
- `integrations/metadata-agent.adapter.ts` — `registerMetadataAgent(api, {url, mode})`: replaces `erschliessen`, `bypassLogin`, calls `disableLoginRequirement()`.

Modified:
- `model/options.ts` — `OptionId=string`, `BUILTIN_OPTION_IDS`, `OptionIcon`/`OptionView` unions, `bypassLogin`/`view`/`external` on `AppOption`, `guest` on `Conditions`, `requiresLogin` exported.
- `services/navigation.service.ts` — registry-driven; `loginRequirementDisabled` signal; `land()` skips login gate when disabled and always resolves to a visible view.
- `services/ui-state.service.ts` — added `guest` to `conditions`.
- `components/menu.component.ts` + `.html` — `iconUrl()`/`iconHtml()` handle icon union (built-in/sanitized-svg/img-url).
- `app.component.ts` + `.html` — `dispatchKey()`/`currentOption()` computeds; `ngSwitch` dispatcher renders `es-extension-view-host` for element/iframe views (incl. replaced built-in ids); fires `additionalWc.init()` after `land()`.
- `manifest.base.json` — added `frame-src 'self' https:; child-src 'self' https:`.
- `manifest.firefox.json` — full CSP override adding `http://localhost:*` to `script-src`/`style-src`/`frame-src` + Google-Fonts, for element-mode local testing.

## ⚠️ TEST-ONLY hacks to REVERT before production
- `app-src/src/app/config.ts`: `additionalWebComponentUrl: 'http://localhost:4300'` and
  `additionalWebComponentMode: 'element'` → blank the URL (`''`) for production.
- `manifest.firefox.json`: the `http://localhost:*` CSP relaxations (keep only what a real
  deployment needs; ideally gate behind a dev flag).
- Diagnostic `console.log`s in `additional-webcomponent.service.ts` can stay or be trimmed.

## Local test setup (element mode, Firefox)
Metadata-agent source: `/home/reuter/Downloads/metadata-agent-webcomponent-main.zip`
(unzipped + built at `<scratchpad>/agent`, i.e.
`/tmp/claude-1000/-home-reuter-Documents-repositorys-edu-sharing-browser-plugin/453ea3ce-deda-4cfe-9855-7ccbe5a6bca5/scratchpad/agent`).

Serve the agent (already built via `npx ng build --configuration extension` → `dist-extension/`
with unhashed `runtime.js`/`polyfills.js`/`main.js`/`styles.css`):
```
python3 -m http.server 4300 --directory <scratchpad>/agent/dist-extension
```
Element-mode load order (from the agent's index.html): **runtime.js → polyfills.js → main.js**
(all ES modules) + `styles.css` link. `main.js` self-registers `<metadata-agent-canvas>` because
the sidebar page has no `<app-root>`. Agent API defaults to the public Vercel endpoint (no local
backend needed). NOTE: the scratchpad is session-scoped — the served build may need rebuilding in
a new session.

Build + run the extension in Firefox:
```
npm run build:firefox && npm run start:firefox   # web-ext run --source-dir dist/firefox
```

## Current status / OPEN ISSUE
Implementation compiles; `ng build` and `build:chrome`/`build:firefox` succeed. Local agent server
on :4300 verified via curl (JS MIME, 200).

**Open**: user reported the sidebar still lands on **Login** on start. Fix applied: the loader now
registers the contribution and calls `disableLoginRequirement()` **immediately after the
reachability check** (before the heavy bundle download), and re-`land()`s off the login view — so a
slow/blocked bundle can no longer strand the user on login. **Awaiting the user's re-test + the
`[edu-sharing][additional-wc]` console output** from the sidebar iframe to confirm the cause:
- no logs → `init()` not running;
- `not reachable` → extension-context fetch to :4300 fails;
- `contribution registered … = true` but still login → unexpected, inspect `nav.view()`;
- `element bundle failed (CSP?)` → Firefox blocks the remote script → switch to **iframe mode**
  (`additionalWebComponentMode: 'iframe'`, ensure `frame-src http://localhost:*`, rebuild).

## Verify checklist (UI/integration only, no real extraction)
1. Logged out → lands on **menu**, not login. 2. "Inhalt erschließen" present as guest (contributed).
3. Opening it mounts `<metadata-agent-canvas>` inline. 4. Context URL reaches the element.
5. Back-to-menu tears down element/listeners. 6. No CSP violations in console.

## Gotchas
- **Zoneless CD**: inbound `postMessage`/subscriptions must write to signals (services do) or the UI won't update.
- **Sidebar console**: it's an injected iframe — inspect the iframe context to see the app's logs.
- `ConfigService.observeVariables()` hits `/config/v1/variables` on the bootstrapped repo; repo switch reloads the sidebar (`AuthService.applyRepositoryChange`).
- Do not blindly `bypassSecurityTrustHtml` remote SVG (menu icons sanitize; URL icons use `<img>`).
