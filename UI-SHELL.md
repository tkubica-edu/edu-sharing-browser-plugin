# The panel shell — options, navigation, session

How the sidebar decides what to show. The catalogue of what the options *do* is
[FEATURES.md](FEATURES.md); the parts they run in are [ARCHITECTURE.md](ARCHITECTURE.md).

- [No wizard: options and conditions](#no-wizard-options-and-conditions)
- [Chrome: topbar, status bar, footer](#chrome-topbar-status-bar-footer)
- [Going back, and letting a content go](#going-back-and-letting-a-content-go)
- [While a write is in flight](#while-a-write-is-in-flight)
- [Page changes the panel asks for itself](#page-changes-the-panel-asks-for-itself)
- [Login, session restore and the guest gate](#login-session-restore-and-the-guest-gate)

---

## No wizard: options and conditions

The start view is always the list of **Aktionen & Optionen** — only being logged out (→ the login
gate) or an explicitly loaded node (→ its Vorschau) opens something else. No option opens itself
from a page match: what the current page offers stays visible instead of being decided for the user.

There is no wizard and no fixed step order: every option is offered whenever its preconditions hold.
`ConditionsService` collects those facts (login, OnlyOffice page, Edu-Sharing page, active node,
editable metadata, edit mode) and each option in `model/options.ts` decides its own visibility from
that snapshot. The list order is the registry's, with one context rule in
`NavigationService.visibleOptions`: on an OnlyOffice page *Inhalt suchen* leads the menu.

## Chrome: topbar, status bar, footer

- **Topbar.** The two options that are not actions on content but always-available utilities —
  *Verlauf* and *Einstellungen* — are marked `topbar: true` and render as icons next to the close
  button (`NavigationService.topbarOptions`). They are otherwise ordinary options, so visibility,
  guards and the view title work the same.
- **Status bar.** Shows the same facts as chips, so it is always visible why an option appears or
  disappears — and it can drop the active content again.
- **Footer.** `ActionBarService` contributes the current view's next steps: *Erschließung starten*
  on the analyze screen, *Speichern* on the metadata screen, and the choice between *Metadaten
  editieren* / *Sammlung zuordnen* on the preview. Screens that own their own action (the selectors,
  login, settings) get no footer.

## Going back, and letting a content go

The **back button** walks back through the steps the user came through (`NavigationService.back`) and
reaches the menu at the end of the trail; switching sub steps within a section is not a step of its
own.

A step that holds something the walk back would destroy **asks first**: it registers a `LeaveGuard` with
`NavigationService`, which `back()` consults before it moves, so one confirmation covers both back buttons —
the topbar's and the footer's, which make the same walk. The KI-Qualitätsprüfung is the one step that does,
because its dialogue lives in the chat widget and ends with the screen (see [chatbot.md](chatbot.md)).

Stepping back to a view that does not need a content **releases a content the user picked** — going
back into *Eigene Inhalte* from *Inhaltsoptionen* means picking again — while a *detected* one is
kept, since it describes the open page (`CurationService.releaseChosenContent`). The trail is carried
across a page change with the rest of the session state (`SessionResumeService`).

## While a write is in flight

The whole chrome is disabled — `BusyService.busy` (`CurationService.saving` ∨ `assigning`), read by
the topbar icons, the close button, the back button, the tab bar, the session bar and every footer
action, and enforced again in `NavigationService.go` / `back` / `goTab` so nothing routes around a
disabled control.

A save is more than the one request the button waits for: the node is created, then the confirmed
quality, the picture and the forwarding are written onto it, so leaving mid-way (a logout takes the
session those run under, closing tears the panel down) is what leaves a content half-written. It is
deliberately *derived* from the services that write rather than a flag of its own, and deliberately
**not** a condition of the navigation registry — a section that turns disabled is one the guard
re-lands away from, which is the very thing this prevents. The editors are locked by
`CurationService.metadataLocked` for the same span.

## Page changes the panel asks for itself

**Picking a content takes the tab with it**: a node chosen in *Meine Inhalte* or im *Verlauf* opens
its own page in the repository (`…/components/render/<id>`) and the panel comes back there on
*Inhaltsoptionen*, working on that same node (`ContentFlowService.showContentOptions`). The page then
shows the content the panel's steps act on.

The panel cannot survive the load — it is an iframe in the page — so the state is written to storage
first and restored on boot, exactly as for the *Bearbeitungsmodus*, which takes the tab to the
connector the same way. The step is **not entered before the load**: it is carried across in that
stored state (`NavigationService.stateFor`) and the panel stays on the screen the content was picked
from, so the Inhaltsoptionen are not shown for the moment before the page replaces them. A tab
already standing on that page is left alone — then there is no load, and the step is entered right
away.

The mechanics of putting the panel back and restoring what it was doing (background worker,
`storage.session`, `SessionResumeService`) are documented in
[content/CLAUDE.md § Direction 4](content/CLAUDE.md).

## Login, session restore and the guest gate

Authentication against an edu-sharing repository uses the official
[`ngx-edu-sharing-api`](https://www.npmjs.com/package/ngx-edu-sharing-api) library. The repository
session is shared, so signing in on either primary tab unblocks both.

**Session restore.** Login is cookie-based: Basic auth is sent only on the login request, the server
sets a session cookie, and every later request carries it (`withCredentials`). That cookie outlives
sidebar reloads, so on startup `AuthService.init` revalidates it (`observeLoginInfo()`, 8 s timeout)
and, if a valid non-guest session is still active, restores the logged-in state before the shell
lands on a view — you don't re-enter credentials when reopening the panel or switching pages, and
**no password is stored**. If the cookie is gone (browser restart, explicit logout, or Safari ITP
blocking the third-party cookie) it resolves to guest and the login gate appears.

**Sections a guest cannot be served by** (`AppSection.requiresSession`: *Inhalt hinzufügen*, *Meine
Inhalte*, and — while the content is past the agent route's two-hour editing window, see
[ARCHITECTURE.md § Saving a content](ARCHITECTURE.md#saving-a-content) — *Qualitätsprüfung*, *An
Redaktionen weiterleiten*, *Sammlung auswählen*) stay listed and enterable. What they show is the
login instead of their screen — `LoginGateComponent` around the same `LoginComponent` the Login
section renders, filling the screen's place like any other view. Its footer is the shared action bar
with the way back on it, and the session bar and the assistant bar stay away for as long as the gate
is up (`NavigationService.sessionGate`, read by the shell, `ActionBarService` and both bars).

Nothing has to be re-entered once the session exists: the gate is a condition, not a step, so the
screen behind it renders the moment the login succeeds. *Register* and *Passwort vergessen* are the
repository's own forms (`/components/register`, `/components/register/request`) and open in the
docked tab — `RepositoryPageService`, which saves the resume state first because the load tears the
panel down.

Where the repository config enables the WLO custom web component, the login is switched off
entirely; see [WEB-COMPONENTS.md](WEB-COMPONENTS.md#the-optional-wlo-metadata-editor).
