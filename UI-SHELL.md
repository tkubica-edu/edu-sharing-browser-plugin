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

- **Topbar.** The option that is not an action on content but an always-available utility —
  *Einstellungen* — is marked `topbar: true` and renders as an icon next to the close button
  (`NavigationService.topbarSections`). Visibility, guards and the view title work as for any other
  section, but it is **laid over the open step rather than entered in its place**
  (`NavigationService.overlaySection`, set by `toggle`): the step is not navigated away from, so it
  stays mounted behind the utility and keeps what it holds — the KI check's dialogue above all, which
  lives in the chat widget and would start over with a screen that mounts anew. The shell takes the
  covered step off screen instead of tearing it down (`.step.is-covered`), and the tab bar, the footer
  and the session bar of that step give way to the utility while it is up.
  Beside those icons, and not a section at all, stands the theme switch: its glyph is the theme that
  is up (a sun in the light panel, a moon in the dark one) and pressing it changes to the other one
  (`ThemeService.toggle`). It offers those two only — *System folgen* is a standing answer rather than
  a switch, and it is set in the Einstellungen. Unlike its neighbours it stays usable while a write is
  in flight: it neither leaves the open step nor touches what is being written.
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
because its dialogue lives in the chat widget and ends with the screen (see [CHATBOT.md](CHATBOT.md)).

While a utility covers the step, back **closes the utility** and asks nothing: the step underneath was
never left, so neither its guard nor its trail is involved.

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

**Picking a content leaves the tab where it is**: a node chosen in *Meine Inhalte* or im *Verlauf*
becomes the panel's content and the *Inhaltsoptionen* open on it right away
(`ContentFlowService.showContentOptions`) — the page the person is reading is theirs, not the panel's
to replace, so nothing is sent to the content's own page in the repository.

Always the junction, whatever step the entry remembers (`HistoryEntry.step`): picking a content is
choosing what to work on, and what to do with it is the next choice rather than one the panel makes.
Where a content was left is still said — on the main menu's card for an Erschließung that was left
unfinished (`CurationService.leftAtStep`), which continues it there.

That card **names the step it would continue at** before it is pressed, in a line under it:
`NavigationService.stepLabel` resolves the remembered step against the registry — the section's title,
plus the sub step behind it where the section has more than one to tell apart (*Qualitätsprüfung –
Metadaten*) — so a step renamed in the registry is renamed here too. Beside it stands the other way on,
*Stattdessen zu den Inhaltsoptionen*: the card can only do one thing when pressed, and continuing a
half-described content is not always what is wanted of it — looking at it, filing it or handing it on
are all reached from the junction instead. The line is shown only where the card really is that offer,
which is the same answer the card's own press uses (`MenuComponent.resumeState`), so the two cannot come
apart. It is projected into the card's `[cardAside]` slot rather than rendered under it: an interactive
card is a `<button>`, and a second control inside one is neither valid nor clickable.

That remembered step is the step the content was **left** on, not the one its save was made from: for
as long as the panel works on a content the history holds, every move writes the step onto its entry
(`NavigationService` → `HistoryService.noteStep`). The main menu is not such a step — it is where the
offer to continue is made, so a content taken up there keeps the step it is offered for.

**The Bearbeitungsmodus is the step that does take the tab along**: it opens the node in its
connector, or in the node's own page (`…/components/render/<id>`) where there is none
(`ContentFlowService.edit`). The panel cannot survive that load — it is an iframe in the page — so
its state is written to storage first and restored on boot; a tab already standing on that page is
left alone, and the panel only switches into the mode.

The mechanics of putting the panel back and restoring what it was doing (background worker,
`storage.session`, `SessionResumeService`) are documented in
[content/HOST-EVENTS.md § Direction 4](content/HOST-EVENTS.md#direction-4--extension--browser-staying-open-across-page-changes).

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

**Signing in through an identity provider.** Where an OpenID Connect client is configured
(*Einstellungen → SSO-Anmeldung*, `OAuthService`), the same login card offers a second way in below
the credential form. It is the Authorization Code flow with PKCE (RFC 7636) and no client secret,
which an extension could not keep: the flow runs in the background worker rather than in the panel,
because the panel is an iframe the host page's navigation destroys and would take an in-flight flow
with it — see
[ARCHITECTURE.md § The OAuth flow](ARCHITECTURE.md#the-oauth-flow). The access token it ends with is
traded for an ordinary repository session (`AuthService.loginWithOAuth` →
`AuthenticationService.loginToken`, which presents it as a bearer token against
`validateSession`), so everything past the login is the cookie-based session described above and no
screen knows which way in was used. The trade is the step that can still refuse a completed OAuth
login: the person is who the provider says they are, and the repository may still not know them.

Which buttons the card shows follows from the repository. Its login info advertises the providers it
federates against (`oauthEntries`, read by `AuthService.applyOAuthEntries`); each entry with a
`registrationId` becomes a button that names that provider in the authorization request, so the
provider goes straight there instead of showing its own chooser. A repository advertising none — the
ordinary case — leaves a single *Mit SSO anmelden* button and lets the provider ask.

**Resuming an OAuth session.** The flow keeps its refresh token in `browser.storage.local`
(`eduSharingOAuthTokens`, written only by the worker). `AuthService.init` uses it after the cookie
restore above has come up empty, so a repository session lost to a timeout or a browser restart is
put back without anything being shown. It is silent in both directions: a stored token that no
longer works is not reported, because nobody asked for a login, and the login card it leaves standing
says the rest. *Abmelden* drops both — the repository session and the stored tokens, with the
provider's revocation endpoint told where its discovery document names one — since leaving the
refresh token behind would sign the user straight back in on the next boot.

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
