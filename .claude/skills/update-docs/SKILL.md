---
name: update-docs
description: Keep this repo's markdown documentation in step with the code. Use after adding a feature, option, screen, service, endpoint, config variable, build step or known limitation — and whenever a change alters behaviour that FEATURES/UI-SHELL/ARCHITECTURE/WEB-COMPONENTS/BUILD/TESTING/TROUBLESHOOTING already describe. Also use when asked to "document this", "update the README/docs", or before a release.
---

# Update the documentation for a change

The docs are split by subject, and each subject lives in exactly one file. A change is documented by
editing the file that owns its subject — never by appending to the README, and never by describing
the same thing twice.

## 1. Find what changed

```bash
git diff && git diff --staged && git status --short
```

Untracked files count. With no diff, use the change made earlier in the conversation. Read the code
you are about to describe — the docs name services, elements and config variables exactly, so a
guessed identifier is worse than no sentence.

## 2. Route it to the owning file

| The change touches | Document it in |
|---|---|
| `app-src/src/app/model/options.ts`, `model/navigation.ts` (a new option/section), `features/**` screens, what an option *does* | `FEATURES.md` |
| `services/conditions`, `navigation`, `action-bar`, `busy`, `session-resume`, `auth`, the topbar/status bar/footer, back trail, guest gate | `UI-SHELL.md` |
| `background/**`, `content/content.js`, `services/metadata-agent-api`, `repository-node`, `curation` save paths, endpoints, CORS, where a request runs | `ARCHITECTURE.md` |
| `services/web-component-bundle.service.ts`, `scripts/{edu,wlo,boerdi}/`, `metadata-agent-canvas`, embedding rules, `browserExtensionCustomWebComponent` | `WEB-COMPONENTS.md` |
| `scripts/build.mjs`, `manifest.*.json`, `.github/workflows/**`, packaging, versioning, release steps | `BUILD.md` |
| `services/debug.service.ts`, loading the extension, test steps, which console shows what | `TESTING.md` |
| A limitation, a browser quirk, a permission that needs explaining, an unverified assumption | `TROUBLESHOOTING.md` |
| `content/panel-host.js`, `model/onlyoffice-events.ts`, the `window:message` listener, any host-page event | `content/CLAUDE.md` |
| `<metadata-agent-canvas>` attributes, layouts, events | `WIDGET-REFERENZ.md` |

Nothing fits? Add a section to the closest file. A new **file** is justified only when a subject
needs its own page (> ~60 lines) and no existing file owns it — then also add it to the README's
documentation table.

**The README changes only when** the one-line summary of the project, the quickstart, the project
layout, the configuration entry points or the documentation index is affected. Feature detail never
goes there; link to the owning file instead.

## 3. Write it in the docs' voice

- **English prose, dense, no bullet-per-sentence.** Match the surrounding paragraphs.
- **Name the mechanism.** `CurationService.saveCollected`, `browserExtensionEditorialGroups`,
  `edu-sharing-usages` — a reader must be able to grep for it.
- **State the constraint, not the story.** Why the code must be this way survives ("the wrapper
  throws unless the inputs are set before connect"); what was tried first does not.
- **Never write a changelog line.** No "now also…", "changed so that…", "as of this version". The
  docs describe the system as it stands; the history is in git.
- **Say what is unverified** rather than implying it works — that is what `TROUBLESHOOTING.md` is
  for.
- Keep prose lines under ~100 characters; tables may run long.

## 4. Keep the set consistent

- **One home per subject.** If the new text repeats something another file says, cut it and link:
  `[ARCHITECTURE.md § Saving a content](ARCHITECTURE.md#saving-a-content)`.
- **Update the cross-references** that the change invalidates — a renamed section breaks anchors in
  other files.
- **Update the flow lists** in `FEATURES.md § Two flows end to end` and the checklist in
  `TESTING.md` when a step is added, removed or reordered.
- **Update `README.md`'s documentation table** when a file is added or renamed.

## 5. Verify

```bash
python3 .claude/skills/update-docs/check-links.py
```

It resolves every relative link and `#anchor` across the doc set and exits non-zero on a broken one.
Then re-read your own paragraph once: does it name the mechanism, does it say why, and is it in the
one file that owns the subject?

## Report

List which file each piece of the change was documented in, one line each, and name anything you
deliberately did **not** document (too small, internal refactor, no behaviour change).
