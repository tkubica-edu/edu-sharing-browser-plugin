# Token & session lifetimes, and the session a token login lands in

Written because a stored OAuth record was found carrying an access token that had been expired
for over an hour, with an untouched refresh token beside it, while the extension kept working:

```json
{
  "accessToken": "eyJraWQiOiJvYXV0aDItcnNhIiwiYWxnIjoiUlMyNTYifQ…",
  "clientId": "browser-plugin",
  "expiresAt": 1788421257038,
  "idToken": null,
  "refreshToken": "TU-o45XJ0oT9vOp1fyMeFmVusHC8hfySMxldINtYFYn2fyaTBz4p94u4uyydUyr4…",
  "repository": "http://repository.127.0.0.1.nip.io/edu-sharing"
}
```

The token's own claims: `iat` 1788420987, `exp` 1788421287 — a **300-second** lifetime — and
`expiresAt` 1788421257038 is exactly 30 s earlier, which is `EXPIRY_SKEW_S`
(`background/oauth.js`). So the stored expiry is computed correctly. The question is who reads it.

References here name files and symbols rather than line numbers, which rot on the next edit of the
file they point into: every symbol below is greppable.

- [Why nothing breaks](#why-nothing-breaks)
- [Is that right?](#is-that-right)
- [What the refresh token is for](#what-the-refresh-token-is-for)
- [The session a token login lands in](#the-session-a-token-login-lands-in)
- [Open findings](#open-findings)
- [Closed findings](#closed-findings)
- [Cross-references](#cross-references)

---

## Why nothing breaks

**The access token is not the credential the extension works with.** It is spent exactly once:

1. `background/oauth.js` runs the PKCE flow, stores the session in `storage.local` under
   `eduSharingOAuthTokens` (`TOKEN_STORAGE_KEY`, written by `storeTokens` after the code exchange
   and after a refresh), and hands **only** the `accessToken` back to the sidebar (the `oauth.login`
   and `oauth.silent` cases in `background/background.js`).
2. `AuthService.exchangeForSession` posts it once through `loginToken` →
   `GET /rest/authentication/v1/validateSession`. The `Bearer` header is set by
   `setBearerAuthForNextRequest` and **consumed in the same request** (`ngx-edu-sharing-api`'s
   `ApiRequestConfiguration`: the header goes on and `authForNextRequest` is nulled on the line
   after).
3. edu-sharing answers with a **session cookie**. From then on every repository request goes
   through the library's `ApiInterceptor` with `withCredentials` (`app.config.ts`) — cookie, never
   `Authorization: Bearer`.

After step 2 the access token is waste paper. Nothing carries it, and nothing watches it:

- **No expiry check on the request path.** `expiresAt` is read at exactly one place in production
  code, the no-refresh-token branch of `silentSession`, and only on a panel boot.
- **No timer, no proactive refresh.** No `chrome.alarms` / `browser.alarms` anywhere; the
  `alarms` permission is not even in `manifest.base.json`.
- **No 401 interceptor.** `ApiInterceptor.intercept` applies headers and counts in-flight
  requests; it inspects no status. No `onError` handler and no own `HTTP_INTERCEPTORS` entry
  exists in the project.

So the token's expiry has **no observable effect**.

What actually governs the session is the **repository's** session timeout, which edu-sharing
resets on every API call (`AuthService.watchSession` → `observeTimeUntilAutoLogout`; the library
recomputes `sessionTimeout` per call). Anyone using the panel keeps extending it, which is why it
never ran out.

And the refresh token is touched in one place only: `silentSession()` on a panel boot, reached from
`AuthService.init` → `resumeOAuthSession` — and only when the cookie is already gone, since
`restoreSession()` succeeds first and skips the path entirely. There is also no `oauth.refresh`
message: `ALLOWED_ACTIONS` in `background/background.js` lists only `oauth.login`, `oauth.silent`,
`oauth.logout`, `oauth.redirectUri`, `oauth.discover`, beside the panel's other actions.

Incidentally, no cookie name (`JSESSIONID`, `ES_AUTH`, `EDU-TICKET`) appears anywhere in the
extension's own code — it only ever says `withCredentials` / `credentials: 'include'` and
leaves the rest to the browser. The one exception is `dropRepositoryCookies`, which names none
either: it removes whatever the browser would send to the repository's address.

## Is that right?

**Architecturally, yes.** Trading a bearer token once for a cookie is the correct shape for
edu-sharing, which authorizes by session. There is no missing "refresh before every request",
because no request uses the token.

The order inside `silentSession` is right too, and stays: the stored access token is
deliberately **not** taken as evidence of a live session, however far its `expiresAt` still is
away. Otherwise it would keep minting fresh repository sessions for a user who has signed out
everywhere they can see — a panel that cannot be logged out of. A refresh (which the provider has
to validate) is the stronger check and is preferred wherever there is a refresh token to make it
with.

What was wrong for a long time is that the store and its documentation described a different system
than the one running: the silent resume was documented as resting on a userinfo endpoint this
repository does not publish, while the refresh path it dismissed was the live one and was refused by
the token endpoint. Both halves of that have since been settled — see
[Closed findings](#closed-findings). What the store still keeps is the one field nobody needs any
more, the expired access token that prompted this document (findings 3 and 4).

---

## What the refresh token is for

The obvious question: if the access token is spent once and the cookie carries everything
afterwards, why is there a refresh token in the record at all?

### Where it comes from

Nobody asked for it. The extension requests `profile` and deliberately not `offline_access`
(`APP_CONFIG.oauth.scopes`, `DEFAULT_SCOPES` in `background/oauth.js`). It comes from the
repository's own authorization server — path 1 in
[TESTING.md § An identity provider to test the SSO login against](TESTING.md#an-identity-provider-to-test-the-sso-login-against),
`security.authentication.oauth2.enabled` plus a `browser-plugin` client. That server is Spring
Authorization Server (its endpoints live under `<repository>/oauth2server/…`), and it issues a
refresh token whenever the client registration carries the `refresh_token` grant — **no
`offline_access` scope required**, unlike the Keycloak/OIDC convention. `toSession` simply stores
what came back.

### Its three jobs, and which of them this repository serves

1. **Silent resume on boot** — `silentSession` → `refresh`, reached from
   `AuthService.resumeOAuthSession`. **Live against this repository.** The token endpoint serves
   `grant_type=refresh_token` to the public `browser-plugin` client; a lost cookie is therefore put
   back without anybody being asked, which is what holding a refresh token is for. It was not always
   so: the deployment used to bounce that grant to `/edu-sharing/components/login?next=/shibboleth`
   before it reached the OAuth2 handler, so every lost cookie — a browser restart included — meant
   the login card. That was a repository-side configuration, not this repo's, and it is gone.
2. **Revocation on logout** — `logout` in `background/oauth.js`, `token_type_hint=refresh_token`.
   This is the **only** token the extension ever revokes; the access token is never sent to the
   revocation endpoint.
3. **The stronger liveness proof** — with a refresh token, `silentSession` makes the provider
   validate a grant it invalidates on logout. Without one, the fallback is a `userinfo` probe
   (`stillSignedIn`), and where the server publishes no `userinfo_endpoint`, no resume is possible
   at all. **Unavailable here:** the repository's metadata names no `userinfo_endpoint` (verified
   against `<repository>/.well-known/oauth-authorization-server`; `/oauth2server/userinfo` and
   `/.well-known/openid-configuration` both answer `404`). This is plain OAuth2, not OIDC — which
   is also why `idToken` is `null` in the record. Job 1 is what carries the resume here; there is no
   second route behind it.

### A note on the metadata

The same document advertises `refresh_token` in `grant_types_supported` and omits `none` from
`token_endpoint_auth_methods_supported`, although the public `browser-plugin` client demonstrably
authenticates with none. Only the endpoint addresses in it can be taken at face value, which is all
the extension reads out of it (`readEndpoints`).

---

## The session a token login lands in

A live silent resume brought out a second thing the design had never had to face: **whose session
the bearer login authenticates.** Measured against
`http://repository.127.0.0.1.nip.io/edu-sharing`, admin user, after *Einstellungen →
Session-Cookie entfernen → Panel neu laden*.

The panel came back signed in, and the first save then failed:

```
POST /rest/node/v1/nodes/-home-/-inbox-/children?type=ccm%3Aio&renameIfExists=true
       &versionComment=MAIN_FILE_UPLOAD&obeyMds=true
403   X-Edu-Authenticated: true   (no Set-Cookie: the cookie sent was a session the server knew)
{"error":"org.edu_sharing.restservices.DAOToolPermissionException",
 "message":"TOOLPERMISSION_CREATE_ELEMENTS_FILES is missing for current user"}
```

What `validateSession` said about the two sessions, the working one and the resumed one:

| | before the reset | after the reset |
|---|---|---|
| `authorityName` | `admin` | `admin` |
| `isGuest` | false | false |
| `currentScope` | null | null |
| `/iam/v1/people/-home-/-me-` | 200 | 200 |
| tool permissions | **58**, `TOOLPERMISSION_CREATE_ELEMENTS_FILES` among them | **34**, without it |

The 34 are not a subset that happens to be short: they are **byte-identical to the anonymous
session's** list — nothing extra, nothing missing. So the resumed session was named after the user
and authenticated as the user, while carrying the rights of a guest. Two answers tell that state
apart from the guest it resembles: a guest is refused the same POST earlier, with
`DAOSecurityException` and `X-Edu-Authenticated: false`, and `-home-` resolves for a guest as well
(`GET /nodes/-home-/-inbox-/metadata` → 200), so neither the alias nor the folder is what fails.

**What caused it.** The boot has already made requests by the time the resume runs — the login-info
call in `restoreSession` at the least — and each was answered with a session cookie. The bearer
login then **took that guest session over** instead of authoring one, and the tool permissions the
repository had resolved for it stayed what they were. That the set is fixed once per session is an
inference from the behaviour, not from the repository's code: it survived every later request in
that session, including ones made after the login had succeeded.

**The fix, in the panel.** `AuthService.restoreSession` reports whether the repository *answered* —
a guest is an answer, an unreachable repository is none — and `resumeOAuthSession` drops the
repository's cookies through `BrowserExtensionService.dropSessionCookies` (worker action
`session.dropCookies` → `dropRepositoryCookies`) before handing the token to
`exchangeForSession`, so the token login is the sole author of the session it authenticates. It is
narrowed to that case twice over, because the cookies go for the whole browser: only once a token is
actually in hand, and only for a session the repository has described. A boot with nothing to resume
from, or one that merely could not reach the repository, leaves the session it has alone rather than
signing the user out of their own repository tabs.

The failure was reproducible on every reset and did not recur afterwards; the resumed session comes
back with the full 58. Two specs in `auth.service.spec.ts` pin both branches — the drop on a guest
session, and no drop where the repository never said what the session is.

**What is not established** is whether an interactive login was ever affected. It ends in the same
`loginToken` call, but the provider's pages are visited top-level on the way, which authenticates
the cookie session by itself — so there the bearer login only confirms a session that already
carries the user's rights, and the observed 58 may be owed to that rather than to the login path.
Nothing in the panel depends on the difference now that the resume authors its own session.

---

## Open findings

### 3. `expiresAt` is dead data across the message boundary

Inside the worker it has exactly one use: the guard in `silentSession`'s branch without a refresh
token. Beyond that it is handed to the sidebar (the `oauth.login` and `oauth.silent` answers in
`background/background.js`) and typed in `OAuthSession`
(`browser-extension.service.ts`) — and read by nobody there (`OAuthService.silentAccessToken` and
`login` read `accessToken` only; `OAuthOutcome` drops it).

The panel should not read it either: it spends the token immediately, so its remaining lifetime
is not a decision the panel makes.

**Side finding:** the test *"renews a stored access token that has lapsed"*
(`app-src/src/boundary/oauth-flow.spec.ts`) proves nothing. The login in it yields a refresh token,
so `silentSession` returns `refresh(...)` and `expiresAt` is never read — the test would be green
with the guard removed. The `expiresAt` guard has no real coverage today.

### 4. An expired access token stays in storage forever

Exactly the observed finding this document opens with. Once a refresh token exists, the
userinfo branch of `silentSession` is unreachable, so the stored `accessToken` and `expiresAt` are
**never read again**. What is left is a bearer credential at rest with no remaining purpose.

Verified: the only readers of `stored.accessToken` / `stored.expiresAt` are that branch and the
`stillSignedIn` call inside it, all behind the `return refresh(...)` above them.

**Fix:** persist `accessToken` and `expiresAt` only where the server issued **no** refresh token,
which is precisely where the userinfo probe later reads them. The rule belongs in `storeTokens`, not
in its two call sites. `refreshToken`, `idToken`, `repository` and `clientId` stay as they are —
`idToken` is needed for `id_token_hint` in `endSessionAt`.

### 5. The "logout must stick" invariant only holds while a panel is alive

`AuthService.sessionExpired` clears the OAuth tokens when the repository auto-logs-out, and its
comment states why: otherwise the next boot silently mints a new repository session from the refresh
token — "a timeout that expires nothing, and a panel the user cannot get logged out of".

But `observeAutoLogout()` only fires in a **live** panel, and the sidebar is destroyed on every
host-page navigation. So: navigate away → the repository session times out server-side → nobody was
there to clear the tokens → on the next open the cookie is gone and `resumeOAuthSession()` refreshes.
The invariant the comment asserts holds only while a panel happens to be open at the moment the
timeout is reached.

**This is now a real hole.** It used to be closed by accident, because the refresh could not
succeed against this deployment; the token endpoint serves that grant now, so the resume goes
through. Two ways to resolve it, whenever it is taken up:

- **Accept it** — this is what holding a refresh token is for. Then the code stays and
  `sessionExpired()`'s comment must be reduced to what it actually achieves (a logout in a
  running panel), instead of asserting an invariant the panel's death defeats.
- **Enforce it** — the timeout has to outlive the panel. That needs a trace in the worker's
  store: a session deadline written and renewed by the sidebar, which `silentSession()` refuses
  to refresh past.

### 6. No 401 recovery

`AuthService.revalidate()` only runs when the settings dialog closes (`ContextRefreshService`). If
the repository loses the session mid-use — a restart, an admin logout — the panel keeps claiming
"signed in" and requests simply fail. As noted above, `ApiInterceptor` inspects no status and there
is no `onError` handler.

The resolution would be an interceptor that, on a 401 from the repository, tries
`exchangeForSession` once with a freshly refreshed access token and otherwise falls back to the
login card. A 403 is a different thing and must not be swept in with it: the session was accepted
and the operation refused, which no re-login changes — see
[TROUBLESHOOTING.md § A save fails with 403 and a missing tool permission](TROUBLESHOOTING.md#a-save-fails-with-403-and-a-missing-tool-permission).

### 8. A session may be accepted that cannot do what the panel is for

`isValidUser` takes a session on `isValidLogin && !isGuest`, which is what let the half-privileged
session above through. `LoginInfo` carries `toolPermissions`, so the panel could tell at login time
that a save will be refused, and say so instead of offering a flow that ends in a 403 several screens
later. Not implemented: the cause of that state is fixed, and a gate of this shape would refuse a
session for a tool permission that only *some* of the panel's steps need.

---

## Closed findings

### 1. The documented premise about refresh tokens *(closed)*

Five places once claimed that no refresh token is issued without `offline_access`, and that the
silent resume therefore rests "in practice" on the userinfo endpoint. The record this document opens
with disproves it: scope `["profile"]`, refresh token present.

The correct statement, now the one in the code and the docs: **whether a refresh token is issued is
the server's decision, not the scope's** — concretely, whether the client registration carries the
`refresh_token` grant. edu-sharing's Spring Authorization Server does it for `profile`; a
Doorkeeper-based one does not. `APP_CONFIG.oauth.scopes`, `DEFAULT_SCOPES`,
[ARCHITECTURE.md § The OAuth flow](ARCHITECTURE.md#the-oauth-flow),
[UI-SHELL.md § Login, session restore and the guest gate](UI-SHELL.md#login-session-restore-and-the-guest-gate) and
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) all say it that way.

Note that `scopes: 'profile'` itself was right and stays: `offline_access` is correctly left
unrequested, because a scope the server does not define fails the whole authorization request. Only
the stated reason was wrong.

How misleading the old wording was, measured: an exploring agent that read only that code concluded
"no refresh token is ever issued" — the exact inference the comments invited.

### 2. `readStoredTokens`' comment contradicted `silentSession` *(closed)*

It said the access token is stored along "only so a still-valid one can be reused instead of
refreshed", while `silentSession` returns `refresh(...)` unconditionally whenever a refresh token
exists. The comment now states what the stored access token is actually for: the userinfo probe in
the case where there is *no* refresh token.

### 7. The repository refused the refresh grant, and the extension misreported it *(closed)*

The token endpoint used to answer `grant_type=refresh_token` with `302` to
`/edu-sharing/components/login?next=/shibboleth`, so the request never reached grant validation — a
fabricated refresh token got the identical answer. `fetch` followed the redirect onto the login
component, which refuses `POST` with `{"error":"405"}`, and `refresh()` reported "the stored session
is spent" for a grant nothing had been established about, clearing the store as it went.

Both halves are gone. The deployment serves the grant, and `refresh()` tells a judged refusal from
an unjudged one: `tokenGrantWasJudged` recognises the RFC 6749 §5.2 error codes (`OAUTH_ERROR_CODES`)
and only those clear the store — anything else (a redirect, an HTML page, a server error, a timeout)
leaves the refresh token standing, because it is still what a logout has to revoke, and says so in
the log. What is still not read is `refresh_expires_in`, which a server like Keycloak does send.

---

## Cross-references

- [ARCHITECTURE.md § The OAuth flow](ARCHITECTURE.md#the-oauth-flow)
- [UI-SHELL.md § Login, session restore and the guest gate](UI-SHELL.md#login-session-restore-and-the-guest-gate)
- [TESTING.md § An identity provider to test the SSO login against](TESTING.md#an-identity-provider-to-test-the-sso-login-against)
  (provider fixtures; note `offline_access` in the Keycloak `scopes_supported`)
- [TROUBLESHOOTING.md § A save fails with 403 and a missing tool permission](TROUBLESHOOTING.md#a-save-fails-with-403-and-a-missing-tool-permission)
- Tests: `app-src/src/boundary/oauth-flow.spec.ts` (loads `background/oauth.js` against fakes),
  `app-src/src/app/services/oauth.service.spec.ts`, `auth.service.spec.ts`, `logout.service.spec.ts`

### Where each lifetime lives, in one table

| Lifetime | Set by | Read by | Effect when it ends |
|---|---|---|---|
| Access token (300 s here) | IdP, `expires_in` → `expiresAt` (`toSession`) | `silentSession`'s no-refresh-token branch only, on boot | **None** — no request carries it |
| Refresh token | IdP; its own expiry is neither sent nor read | `silentSession` → `refresh` on a boot without a cookie, and `logout` to revoke | Boot refresh is refused → `clearTokens()` → login card |
| Repository session (cookie) | edu-sharing, reset per API call | the browser, on every request | Panel loses access; `observeAutoLogout` fires *if a panel is open* (see finding 5) |
| Repository session's tool permissions | edu-sharing, when the session is created | every write the panel makes | Nothing ends them; a session keeps the set it was resolved with (see [The session a token login lands in](#the-session-a-token-login-lands-in)) |
| IdP SSO session | IdP cookie | `end_session_endpoint` on logout (`endSessionAt`) | Next authorization request asks who is signing in |
