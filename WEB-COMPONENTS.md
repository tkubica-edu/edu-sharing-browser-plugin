# Embedded web components — the packaged bundles

The panel renders the repository's own UI wherever it can, as **real custom elements in the sidebar
document — no iframes**. Three prebuilt bundles ship with the extension:

| Bundle | Source folder → packaged as | Elements it registers |
|---|---|---|
| edu | `scripts/edu/` → `edu/` | `edu-sharing-mds-editor-wrapper`, `edu-sharing-preview-sidebar`, `edu-sharing-nodes-selector`, `edu-sharing-add-with-connector`, `edu-sharing-search`, `edu-sharing-usages`, `edu-sharing-share-qr`, `edu-sharing-location-picker` |
| wlo | `scripts/wlo/` → `wlo/` | `metadata-agent-canvas` (the optional WLO editor) |
| boerdi | `scripts/boerdi/` → `boerdi/` | `boerdi-chat` (the KI assistant) |

- [Loading a bundle](#loading-a-bundle)
- [Handing the theme to a bundle](#handing-the-theme-to-a-bundle)
- [The optional WLO metadata editor](#the-optional-wlo-metadata-editor)
- [Refreshing a bundle](#refreshing-a-bundle)

Attributes and events of `metadata-agent-canvas` are documented in
[WIDGET-REFERENZ.md](WIDGET-REFERENZ.md).

---

## Loading a bundle

The edu bundle is built from the edu-sharing frontend (`npm run build:app-as-component` →
`dist/web-components/app/`) and taken over as a whole.

`WebComponentBundleService` owns the loading: it injects each bundle's stylesheet and scripts once,
sets `window.__env.EDU_SHARING_API_URL` before the edu bundle boots (its HttpClient freezes the
value), and loads a bundle's `polyfills` (zone.js) only if no other bundle brought a Zone already.
Components declare what they need as a field:

```ts
protected readonly bundle = loadWebComponentBundle('edu', 'edu-sharing-preview-sidebar');
```

and gate the tag on `bundle.ready()` / show `bundle.error()`. Pass the tag when the element must be
defined before it renders; omit it when the element is created imperatively or must carry its inputs
as it upgrades (the nodes selector reads `option.optionConfig` on connect, so `NodesSelectorComponent`
renders the tag immediately and only reports load errors).

`MdsEditorComponent` is the one element created imperatively: the wrapper throws in its `ngOnInit`
unless `embedded`/`currentValues` are already set, and Angular applies template bindings only *after*
connect — so the element is built with every input assigned, then appended. In embedded mode it
renders no buttons of its own; the footer's save action calls `commit()`, and edited values arrive
via its `currentValuesChange` event.

The elements' own repository calls (MDS definition, value rendering) reuse the login session cookie
when the user is logged in; as guest they rely on public access.

The `wlo/` bundle reads `window.__ENV.agentUrl` at bootstrap (falling back to its own hardcoded
default), so `WebComponentBundleService` publishes the configured `APP_CONFIG.apiUrl` there before
the scripts run — mirroring `window.__env.EDU_SHARING_API_URL` for the edu bundle. `wlo/`'s file
names are content-hashed, so its entry points are read from its own `index.html`; `edu/` and
`boerdi/` have stable names and are declared in the service.

## Handing the theme to a bundle

The bundles run in the panel's own document, so a light form in a dark panel is not an embedding
detail but the panel's own surface being wrong. Each bundle is therefore handed the theme
`ThemeService` resolved, and each takes it differently:

| Bundle | What it is handed | Follows a switch without a reload |
|---|---|---|
| edu | `localStorage['accessibility_darkMode'] = "auto"` plus an answered `(prefers-color-scheme: dark)` query (`util/bundle-theme.ts`) | yes |
| boerdi | the element's `theme` attribute, `"light"` or `"dark"` (`AiAssistantScreenComponent`) | yes |
| wlo | nothing — the bundle ships no dark theme (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#the-wlo-canvas-has-no-dark-theme)) | – |

The edu bundle's own theme service resolves `(a query param ?? the stored preference) === 'dark'`, or
the media query where that preference is `auto`; from that it puts `isDarkTheme` / `isLightTheme` on
`<body>`, recomputes its whole Material palette and pulls in its dark token set. `installBundleTheme()`
runs as the app boots rather than where the bundle is loaded, because the preference is read at the
bundle's bootstrap and the answer has to exist by then; `publishPanelTheme()` reports every later
switch. The mechanics and the two things to know about the patch are in
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#dependencies-and-runtime-limits).

`styles/_embedded-material.scss` needs nothing for this. Its `:root` overrides win over the `html { … }`
of both bundles, while the edu bundle's dark set is declared on `body.isDarkTheme` and beats `:root`
by inheritance proximity — so the panel's surfaces hold in light and the bundle's own hold in dark.

The boerdi widget's `theme` attribute also takes `auto`, which is deliberately not used: `auto` has
the widget read the browser's preference, and the panel's setting is allowed to overrule exactly that.
It is the one attribute the chat element is given that is followed rather than read once on mount —
the settings are laid *over* the chat screen rather than entered in its place, so the conversation is
still there to be repainted (see [UI-SHELL.md](UI-SHELL.md#chrome-topbar-status-bar-footer)).

## The optional WLO metadata editor

`BrowserExtensionCustomWebComponentService` watches the repository config for the boolean variable
**`browserExtensionCustomWebComponent`**. Its `enabled` is that variable **and** the panel's own
switch for it (see [§ Refusing the variable](#refusing-the-variable)), and everything below hangs on
that one signal. While it is enabled, `WloCanvasComponent` — `<metadata-agent-canvas>` from the
packaged `wlo/` bundle — takes over two screens:

- **Metadaten editieren** (`mode="edit"`) instead of the edu-sharing MDS editor,
- **Vorschau** (`mode="detail"`) instead of `edu-sharing-preview-sidebar`, showing the saved
  properties read-only. Saving still lands there, so the preview follows the edit as before.

It also reshapes the footer buttons: the flag adds `wlo-theme` to the document element, and
`app-src/src/styles/_wlo-theme.scss` rounds them into pills, like the buttons of the bundle itself.
Its colours are not adopted — that palette (surface `#fcf8fd`) tints the panel violet-grey and reads
as washed out beside its own white surfaces, so `_embedded-material.scss` goes on holding the canvas
to the panel's colours instead. In a dark panel that is reversed for these two screens alone: the
canvas has no dark theme, so it keeps its own light one and `_wlo-canvas-light.scss` holds it there,
see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#the-wlo-canvas-has-no-dark-theme).

The per-mode settings are the two presets the bundle's own `examples/canvas-parameter-demo.html`
documents — "Plugin" and "Detail (readonly)" — kept verbatim in `CONFIGS` so they stay comparable
with that reference.

**It also switches the login off.** The variable marks a repository whose embedding host brings the
session, so no credentials are asked for: `AuthService.authorized` (`loggedIn` **or** the variable)
is what option visibility, the landing view, the screens' gates and the API-backed actions are
behind, so the login option and the `es-login` gate never appear and every option is reachable
without a panel login. `AuthService.loggedIn` stays the plain fact of a repository session, but
nothing about a login is *reported* either: `AuthService.loginRequired` is false, so neither the
login option nor the session bar's logged-out state appears. The variables are readable as guest, so
the flag arrives while the panel is still logged out; the navigation guard then re-lands the boot's
login view on the options menu.

Nothing else changes: *Inhalt erschließen* still runs the metadata agent through the background
worker, its result is loaded into the editor, and saving still creates or updates the repository node
and records it in the Verlauf. Which route that save takes is decided by the session, not by this
flag — see [ARCHITECTURE.md § Saving a content](ARCHITECTURE.md#saving-a-content).

**Both editors implement the same `MetadataEditor` contract** (`ready` + `commit()`), so the footer
owns "Speichern" either way and the metadata screen only picks which one to render. In
`mode="detail"` the canvas is read-only and nothing is committed.

Its save/upload buttons stay hidden in both modes (the footer saves) and page mode is off (*Inhalt
erschließen* is the app's own extraction path). Seeding is direct: its `importJsonData` reads
`metadata || <the payload>` plus `metadataset` / `_origins` / `_source_text` / `preview_image_url`,
which is exactly the agent payload shape, so an analysis result and a node's stored properties both
load as-is. Edits arrive continuously via `metadataChange`; on save the namespaced field values are
kept and the envelope is dropped, since it is not node metadata.

## Refusing the variable

A repository that sets the variable makes every panel connected to it a WLO panel, which leaves the
ordinary flow — MDS editor, login, a save without `ccm:oeh_*` fields — unreachable against that
repository. The checkbox **WLO-Funktionen verwenden** in *Einstellungen → Entwickler-Optionen*
(`eduSharingWloEnabled`, default on) is what makes it reachable: with it off the variable is read as
unset whatever the repository answers.

The service keeps the two statements apart. `offeredByRepository` is the config's answer,
`settingEnabled` the switch, and `enabled` is the conjunction — so the checkbox shows what the panel
was told rather than what came back, and a hint beside it names a repository that offers none of this
in the first place. Because every WLO branch in the app reads `enabled` and nothing else — the two
screens above, `metadataSet`, the `wlo-theme` class, `AuthService.authorized` /
`AuthService.loginRequired`, the WLO-only options in `model/navigation.ts`, the `ccm:oeh_*` write and
the `GROUP_ORG_WLO-Uploadmanager` workflow in `CurationService`, and the settings groups that
configure them — the switch reaches all of them at once. Its own card is outside those groups for
that reason: a panel switched off would otherwise have nowhere left to switch itself back on.

`AppComponent` loads the setting before it subscribes to the config, so a panel that has it off never
comes up in the WLO palette. Nothing of a content in hand is let go of: the switch decides which
screens and which fields a save has, and an Erschließung in progress carries on into whichever editor
the metadata screen mounts next.

## Refreshing a bundle

A bundle is replaced by overwriting `scripts/<name>/` with the new build — nothing else is generated
from it. For the boerdi widget `scripts/fetch-widget.mjs` does that, pulling
`<base>/widget/boerdi-widget.js` into `scripts/boerdi/boerdi-widget.js`:

```bash
# the deployed assistant backend — the same host the chat element talks to (CHAT_API_URL)
node scripts/fetch-widget.mjs https://87.106.127.225.nip.io
npm run build:chrome     # without this the new bundle never reaches dist/
```

Pass another base to fetch from elsewhere; the argument defaults to `http://localhost:8000` for a
backend running locally. The script refuses an answer that is HTML rather than JavaScript — a
mistyped base otherwise writes an error page into the bundle, which surfaces only later as a syntax
error while the panel loads. It warns, but does not refuse, when the base is plain `http` on a host
that is not `localhost`: whatever it writes runs with the extension's privileges afterwards, and
there is no checksum to verify it against.

Reload the extension after the build — a swapped bundle is not picked up on its own
([TESTING.md](TESTING.md#load-the-extension)).

Manifest V3 forbids remotely loaded code (`script-src 'self'` on extension pages), which is why the
bundles are packaged rather than loaded from the backend. What reaches `dist/` and what is skipped is
[BUILD.md § What goes into the package](BUILD.md#what-goes-into-the-package).
