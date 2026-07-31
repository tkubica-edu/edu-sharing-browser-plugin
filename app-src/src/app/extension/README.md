# Menu extension point (`app/extension/`)

Makes the **"Aktionen & Optionen"** list customizable: an extension can **add** new
options (with a custom view), **replace** built-in ones, render custom **templates** or
**web-component elements**, and decide whether **login is required** as a first step.

The extension is **inactive by default**. It activates only when the repository config
enables the boolean variable **`additionalWebComponent`**: the packaged **wlo**
web-component bundle (`scripts/wlo/` → `wlo/` in the built extension) is loaded and the
options for its elements are registered. Without the variable, nothing is registered and the
default application runs unchanged.

The option set is currently **hardcoded** in `register-wlo-options.ts` — the bundle only
*provides* the element, it does not self-register. (It still can: the API on
`window.eduSharingExtension` stays available, see *Bundle API*.)

Everything lives in this folder. The core only touches it through a handful of thin,
clearly-commented hooks, so the whole feature can be removed cleanly (see *Removal*).

## Files

| File | Purpose |
|------|---------|
| `extension.model.ts` | Typings: `ExtensionOption`, `CustomOptionRendering`, `CustomRenderingContext`, `EduSharingExtensionApi`. |
| `extension.service.ts` | Activation (config-gated load of the packaged `wlo/` bundle), registry, merge/lookup, `loginRequired`. |
| `ext-element.component.ts` | Renders a dynamic custom-element tag (`<es-ext-element [tag] [data]>`). |
| `ext-screen.component.{ts,html}` | Renders an option's screen from its registered `screen` rendering. |
| `register-wlo-options.ts` | The hardcoded option(s) for the wlo bundle's element(s), plus the element tag. |

## Concepts

- **Option** = one row in the menu, identified by a unique `id`. Built-in ids
  (`login`, `erschliessen`, …) live in `../model/options.ts`; an extension option with
  the same id **replaces** it, a new id is **added**.
- **Rendering** = how an option looks in a **slot**: `menuItem` (the list row) or
  `screen` (the full view). A rendering is either an Angular `templateRef` **or** a
  custom-element `element` tag, gated by an optional `useCallback(conditions)`. When an
  option registers no `menuItem` rendering, it uses the **default** row (same style as the
  built-in options), so a bundle can add an option with just `icon`/`label`/`description`.

## How activation works

1. On startup `AppComponent` calls `ExtensionService.initialize()`, which subscribes to
   `ConfigService.observeVariables()`.
2. When `additionalWebComponent` is enabled, the service exposes the registration API on
   `window.eduSharingExtension` and loads the packaged `wlo/` bundle (once).
3. It then waits for `customElements.whenDefined(WLO_ELEMENT_TAG)` — loading the scripts only
   *starts* the bundle, which defines its elements during its own async bootstrap.
4. Once the element is defined, `registerWloOptions()` registers the option(s) and their
   `screen` renderings, so a referenced tag always upgrades. If the element never appears
   (renamed/missing tag), a warning is logged after 15s and the options are registered
   anyway. A bundle that self-registers via `window.eduSharingExtension.*` can do so at any
   point instead.

## Bundle API (`window.eduSharingExtension`)

```js
const api = window.eduSharingExtension;

api.setLoginRequired(false); // e.g. when custom elements don't need a session

// Add an option that uses the DEFAULT menu row + a custom screen element:
api.registerOption({ id: 'partner-search', label: 'Partner-Suche', icon: '<svg …>…</svg>' });
api.registerRendering({ optionId: 'partner-search', slot: 'screen', element: 'partner-search' });

// …or override a built-in option's menu row with a custom element:
api.registerRendering({ optionId: 'history', slot: 'menuItem', element: 'my-history-row' });
```

Any custom element the bundle defines can be referenced as an `element`; it receives the
`{ option, conditions, slot }` context on its `data` property.

## Loading the bundle

The bundle is **not** fetched from a remote URL: MV3 forbids remote code on extension pages
and the extension CSP is `script-src 'self'`. Instead it is packaged with the extension:

- Drop the built bundle into **`scripts/wlo/`**; `scripts/build.mjs` copies it to
  `dist/<target>/wlo/`, and `manifest.base.json` exposes `wlo/*` as a
  `web_accessible_resource`.
- The bundle's file names are content-hashed, so `ExtensionService` reads
  `wlo/index.html` and loads the `<link rel="stylesheet">` / `<script src>` entries it
  declares, in order — no file names to keep in sync after a rebundle.
- `polyfills.*` (zone.js) is **skipped when a Zone already exists**, because zone.js throws
  on a second load and the `edu/` bundle (see `services/edu-bundle.service.ts`) ships one
  too. Whichever bundle loads first provides Zone for both.

## Try it locally

1. Set the repository config variable `additionalWebComponent` to `true`.
2. Check `WLO_ELEMENT_TAG` in `register-wlo-options.ts` against the tag the bundle defines
   (default `metadata-agent-canvas`).
3. `node scripts/build.mjs --target=firefox` and load it — "WLO Metadaten-Agent" appears
   once the bundle's element is defined.

## Removal

1. Delete this folder.
2. Revert the hooks (each marked with an "extension" comment):
   - `services/navigation.service.ts` — drop the `ExtensionService` injection; use
     `OPTIONS` directly again.
   - `components/menu.component.*` — drop the `items()`/rendering branch; iterate
     `nav.visibleOptions()` with the default row only.
   - `app.component.*` — drop the `extensionService.initialize()` call, `hasExtScreen`,
     and the `es-ext-screen` branches.
   - `model/options.ts` — optionally narrow `OptionId` back to `BuiltinOptionId`.
