# Edu-Sharing — Browser-Extension

Cross-browser WebExtension (Chrome, Edge, Firefox, Safari) that docks an edu-sharing sidebar into any
page: it reads the open page or the open OnlyOffice document, has the **metadata agent** generate
metadata from it, and files the result as a node in an edu-sharing repository — with the
repository's own UI embedded for editing, previewing, sharing and collecting.

- [At a glance](#at-a-glance)
- [Quickstart](#quickstart)
- [Documentation](#documentation)
- [Project layout](#project-layout)
- [Configuration](#configuration)
- [Contributing](#contributing)

---

## At a glance

```
       toolbar click
             │
             ▼
   ┌─────────────────────┐        ┌──────────────────────────┐
   │ page (any https)    │        │ background worker        │
   │  ├ panel-host.js ───┼───────►│  panel state per tab     │
   │  │   docks iframe   │        │  page extraction         │
   │  │                  │        │  POST /generate, /nodes ─┼──► Metadata-Agent
   │  └ sidebar iframe   │◄──────►│                          │    (B-API proxy of
   │      Angular app    │        └──────────────────────────┘     the repository)
   │      + edu/wlo/     │
   │        boerdi       │──────────────────────────────────────► edu-sharing
   └─────────────────────┘   login · nodes · collections · MDS     repository
```

**The flow.** *Inhalt erschließen* reads the tab → the agent generates metadata → the metadata editor
opens → *Speichern* creates the node → preview, filing into collections and editorial groups,
quality check. On an OnlyOffice page the edited document is the active node from the start, and
*Metadaten anreichern* enriches it in place instead of creating anything.

**Three things worth knowing before reading the code:**

1. **There is no wizard.** Every option is offered whenever its preconditions hold
   (`ConditionsService` + `model/options.ts`); nothing opens itself from a page match. See
   [UI-SHELL.md](UI-SHELL.md).
2. **The panel is an iframe in the page, so every navigation destroys it.** Being open is a property
   of the *tab*, restored by the background worker, and what the panel was doing is written to
   storage continuously (`SessionResumeService`).
3. **The repository's UI is embedded as real custom elements** in the sidebar document — no iframes,
   no remote code. The bundles are packaged with the extension; see
   [WEB-COMPONENTS.md](WEB-COMPONENTS.md).

## Quickstart

```bash
npm install            # build harness deps (archiver, web-ext, polyfill)
npm run install:app    # Angular app deps (app-src/)
npm run build          # ng build + assemble dist/{chrome,firefox,safari}
```

Then load it:

| Browser | How |
|---|---|
| Chrome / Edge | `chrome://extensions` → *Developer mode* → *Load unpacked* → `dist/chrome` |
| Firefox | `npm run start:firefox`, or `about:debugging` → *Load Temporary Add-on* → `dist/firefox/manifest.json` |
| Safari | `xcrun safari-web-extension-converter dist/safari`, then run the generated Xcode project |
| Safari (no Xcode) | *Settings* → *Advanced* → **Show features for web developers** (this reveals the *Developer* tab) → *Developer* → *Extensions* → **Allow unsigned extensions** → **Add Temporary Extension…** → `dist/safari` |

Click the toolbar icon on any normal `https://` page. Prebuilt zips for testers hang off every
tagged release — see [BUILD.md](BUILD.md#prebuilt-downloads).

> Changes to the Angular app reach the loaded extension only through `npm run build:<target>` —
> `ng build` inside `app-src/` alone does not refresh `sidebar/` or `dist/`. While developing, use
> `npm run dev:firefox` (or `dev:chrome`) instead: it keeps `dist/<target>/` in step with every edit
> and, on Firefox, reloads the extension — see
> [TESTING.md § Watch mode](TESTING.md#watch-mode-rebuild-on-every-change).

## Documentation

| Document | Contents |
|---|---|
| [FEATURES.md](FEATURES.md) | What the panel offers, option by option — curating, filing, the OnlyOffice-only options |
| [UI-SHELL.md](UI-SHELL.md) | Options and conditions, navigation and the back trail, busy state, login and the guest gate |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The parts, the metadata agent's address, network legs & CORS, which route a save takes |
| [WEB-COMPONENTS.md](WEB-COMPONENTS.md) | The packaged `edu` / `wlo` / `boerdi` bundles, and the optional WLO metadata editor |
| [content/HOST-EVENTS.md](content/HOST-EVENTS.md) | The extension ↔ host-page event contract (`INSERT_NODE`, `PREVIEW_NODE`, `DOCUMENT_*`) |
| [CHATBOT.md](CHATBOT.md) | The KI assistant: where the `boerdi` widget comes from, how it is embedded, the contract surface |
| [CHATBOT-IO.md](CHATBOT-IO.md) | What the assistant is given, asked and answers: contexts, tasks, result schemas, recorded properties |
| [WIDGET-REFERENZ.md](WIDGET-REFERENZ.md) | `<metadata-agent-canvas>`: layouts, attributes, events — a snapshot of the metadata-agent project's own widget, in German |
| [BUILD.md](BUILD.md) | Building, what goes into the package, CI artifacts, cutting a release |
| [TESTING.md](TESTING.md) | Loading the extension, the OnlyOffice debug mode, the manual test checklist |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Known issues, permission quirks, bundle size, lint output |

## Project layout

```
app-src/            Angular 21 app (the sidebar UI) — built to sidebar/
background/         background worker: panel state, page extraction, agent calls
content/            panel-host.js (docks the panel, relays host events), content.js (extraction)
scripts/            build.mjs, fetch-widget.mjs, and the prebuilt bundles edu/ wlo/ boerdi/
sidebar/            build output of app-src/ (packaged as-is)
manifest.*.json     manifest.base.json + one overlay per target
dist/               assembled, loadable extensions (git-ignored)
```

Inside `app-src/src/app/`: `template/` is the panel frame, `features/<domain>/` the screens,
`shared/components/` what more than one domain renders, and `services/` · `model/` · `util/` are
flat.

## Configuration

- **Repository URL** — set in *Einstellungen* (default:
  `https://repository.staging.openeduhub.net/edu-sharing`). Used for login and every embedded
  element; changing it reloads the sidebar.
- **Metadata agent** — not that URL, but the default repository's B-API proxy; see
  [ARCHITECTURE.md](ARCHITECTURE.md#the-metadata-agents-address).
- **Repository config variables** — `browserExtensionCustomWebComponent` swaps in the WLO editor and
  switches the panel login off; `browserExtensionEditorialGroups` names the editorial groups
  contents can be forwarded to.
- **Defaults and storage keys** live in `config.js` (worker) and `app-src/src/app/config.ts` (app).

## Contributing

- Build after every change (`npm run build:chrome`) and reload the extension — the loaded package is
  what runs, not the sources.
- Comments and documentation are written in English; the UI is German.
- Bump the version with `npm run version:set -- <x.y.z>`, which keeps `package.json`,
  `manifest.base.json` and `package-lock.json` in step ([BUILD.md](BUILD.md#cutting-a-release)).
