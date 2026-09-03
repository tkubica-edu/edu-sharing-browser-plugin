# Token & session lifetimes — why an expired access token changes nothing

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
(`background/oauth.js:41`). So the stored expiry is computed correctly. The question is who
reads it.

- [Why nothing breaks](#why-nothing-breaks)
- [Is that right?](#is-that-right)
- [What the refresh token is for — and why it never works here](#what-the-refresh-token-is-for--and-why-it-never-works-here)
- [Findings 1–4: what is wrong](#findings-14-what-is-wrong)
- [Findings 5–7: open, deliberately unchanged](#findings-57-open-deliberately-unchanged)
- [Cross-references](#cross-references)

---

## Why nothing breaks

**The access token is not the credential the extension works with.** It is spent exactly once:

1. `background/oauth.js` runs the PKCE flow, stores the session in `storage.local` under
   `eduSharingOAuthTokens` (`background/oauth.js:26`, written at `:421` after the code exchange
   and `:454-458` after a refresh), and hands **only** the `accessToken` back to the sidebar
   (`background/background.js:729`, and the comment at `:726-728` that says so).
2. `AuthService.exchangeForSession` (`app-src/src/app/services/auth.service.ts:268`) posts it
   once through `loginToken` → `GET /rest/authentication/v1/validateSession`. The `Bearer`
   header is set by `setBearerAuthForNextRequest` and **consumed in the same request**
   (`app-src/node_modules/ngx-edu-sharing-api/fesm2022/ngx-edu-sharing-api.mjs:107-108` sets it, `:135-137` applies and clears it —
   `this.authForNextRequest = null` on the line after the header goes on; `loginWithToken` at `:19347-19352`).
3. edu-sharing answers with a **session cookie**. From then on every repository request goes
   through the library's `ApiInterceptor` with `withCredentials`
   (`app-src/src/app/app.config.ts:13`, `ngx-edu-sharing-api.mjs:34` and `:145`) — cookie, never
   `Authorization: Bearer`.

After step 2 the access token is waste paper. Nothing carries it, and nothing watches it:

- **No expiry check on the request path.** `expiresAt` is read at exactly one line in
  production code, `background/oauth.js:653`, and only on a panel boot.
- **No timer, no proactive refresh.** No `chrome.alarms` / `browser.alarms` anywhere; the
  `alarms` permission is not even in `manifest.base.json`.
- **No 401 interceptor.** `ApiInterceptor.intercept`
  (`ngx-edu-sharing-api.mjs:240-266`) applies headers and counts in-flight requests; it
  inspects no status. No `onError` handler and no own `HTTP_INTERCEPTORS` entry exists in the
  project.

So the token's expiry has **no observable effect**.

What actually governs the session is the **repository's** session timeout, which edu-sharing
resets on every API call (`auth.service.ts:311-316`, `observeTimeUntilAutoLogout`; the
library's `sessionTimeout` is recomputed per call at `ngx-edu-sharing-api.mjs:19286-19288`).
Anyone using the panel keeps extending it, which is why it never ran out.

And the refresh token is never touched because only one place touches it: `silentSession()` on
a panel boot (`background/oauth.js:652`, reached from `AuthService.init` →
`resumeOAuthSession`, `auth.service.ts:147`) — and only when the cookie is already gone, since
`restoreSession()` (`auth.service.ts:153`) succeeds first and skips the path entirely. There is
also no `oauth.refresh` message: `ALLOWED_ACTIONS` (`background/background.js:555-571`) lists
only `oauth.login`, `oauth.silent`, `oauth.logout`, `oauth.redirectUri`, `oauth.discover`.

Incidentally, no cookie name (`JSESSIONID`, `ES_AUTH`, `EDU-TICKET`) appears anywhere in the
extension's own code — it only ever says `withCredentials` / `credentials: 'include'` and
leaves the rest to the browser.

## Is that right?

**Architecturally, yes.** Trading a bearer token once for a cookie is the correct shape for
edu-sharing, which authorizes by session. There is no missing "refresh before every request",
because no request uses the token.

The order inside `silentSession` is right too, and stays: the stored access token is
deliberately **not** taken as evidence of a live session, "however far its `expiresAt` still is
away" (`background/oauth.js:627-636`). Otherwise it would keep minting fresh repository
sessions for a user who has signed out everywhere they can see — a panel that cannot be logged
out of. A refresh (which the provider has to validate) is the stronger check and is preferred
wherever there is a refresh token to make it with.

What is wrong is that **the store and its documentation describe a different system than the
one running.** The store keeps exactly the one field nobody needs any more — the expired access
token that prompted this document (findings 2–4) — while both routes the design relies on for a
silent resume turn out to be unavailable against this repository (findings 1 and 7). The
architecture is sound; the assumptions written around it are not.

---

## What the refresh token is for — and why it never works here

The obvious next question: if the access token is spent once and the cookie carries everything
afterwards, why is there a refresh token in the record at all?

### Where it comes from

Nobody asked for it. The extension requests `profile` and deliberately not `offline_access`
(`app-src/src/app/config.ts:186`, `background/oauth.js:59`). It comes from the repository's own
authorization server — path 1 in `TESTING.md:301-307`, `security.authentication.oauth2.enabled`
plus a `browser-plugin` client. That server is Spring Authorization Server (its endpoints live
under `<repository>/oauth2server/…`), and it issues a refresh token whenever the client
registration carries the `refresh_token` grant — **no `offline_access` scope required**, unlike
the Keycloak/OIDC convention the code's comments assume. `toSession` (`background/oauth.js:352`)
simply stores what came back.

### Its three nominal jobs

1. **Silent resume on boot** — `background/oauth.js:652`, reached from
   `AuthService.resumeOAuthSession` (`app-src/src/app/services/auth.service.ts:147`, `:255`).
2. **Revocation on logout** — `background/oauth.js:490-496`, `token_type_hint=refresh_token`.
   This is the **only** token the extension ever revokes; the access token is never sent to the
   revocation endpoint.
3. **The stronger liveness proof** — with a refresh token, `silentSession` makes the provider
   validate a grant it invalidates on logout. Without one, the fallback is a `userinfo` probe
   (`:681`), and where the server publishes no `userinfo_endpoint`, no resume is possible at all
   (`:682-685`).

### Job 1 does not work against this repository — measured

`POST <repository>/oauth2server/token` with `grant_type=refresh_token` and `client_id=browser-plugin`,
no client authentication — exactly what `refresh()` sends (`background/oauth.js:448-450`) —
answers:

```
HTTP/1.1 302
Location: /edu-sharing/components/login?next=/shibboleth
```

The OAuth2 token handler is never reached: edu-sharing's own authentication filter bounces the
request to its login component. Same endpoint, same client, `grant_type=authorization_code`
instead answers properly with `400 {"error":"invalid_grant"}` — which is why signing in works
while renewing never does. `client_credentials` and the token-exchange grant are bounced the
same way, so the deployment serves only `authorization_code` anonymously at that endpoint.

**A fabricated refresh token gets the identical 302**, which proves the request never reaches
grant validation — so this is not a token that expired. It fails on the first attempt and on
every attempt, regardless of the record's age.

What the extension makes of it: `fetch` follows the redirect (default `redirect: 'follow'`),
lands on the login component, which refuses `POST` with
`{"error":"405","message":"HTTP method POST is not supported by this URL"}`. `fetchJson`
(`:180-182`) throws `OAUTH_TOKEN_FAILED: 405 405`; `refresh()` (`:460-464`) logs **"refresh
failed — the stored session is spent"**, clears the store and rethrows; `silentAccessToken`
(`app-src/src/app/services/oauth.service.ts:171-176`) turns that into a silent `null`. Result:
the login card, with no explanation, and a log line that blames the wrong thing — the session
was not spent, the endpoint refused the grant.

### Job 3 does not exist here either

The repository's metadata names **no `userinfo_endpoint`** (verified against
`<repository>/.well-known/oauth-authorization-server`; `/oauth2server/userinfo` and
`/.well-known/openid-configuration` both answer `404`). This is plain OAuth2, not OIDC — which
is also why `idToken` is `null` in the record. So the fallback path
`silentSession` would take without a refresh token cannot be taken against this repository at
all.

Two consequences worth stating plainly:

- **Silent resume is impossible against this repository, by either route.** Every lost cookie —
  a browser restart included — means the OAuth login card. That matches the observed behaviour.
- **The refresh token's only working job here is revocation on logout.** Holding it is not
  useless, but it is not what the code and comments think it is for.

### A note on the metadata

The same document advertises `refresh_token` in `grant_types_supported`, which the deployment
then does not serve to this client, and omits `none` from
`token_endpoint_auth_methods_supported`, although the public `browser-plugin` client
demonstrably authenticates with none. The discovery document is unreliable in both directions
here; only the endpoint addresses in it can be taken at face value, which is all the extension
reads out of it (`background/oauth.js:128-154`).

---

## Findings 1–4: what is wrong

### 1. The documented premise is false for this deployment

Five places claim that no refresh token is issued without `offline_access`, and that the silent
resume therefore rests "in practice" on the userinfo endpoint:

| Location | Claim |
|---|---|
| `background/oauth.js:49-58` | "`offline_access` … the deployments this runs against do not define it … `silentSession` therefore falls back to the userinfo endpoint" |
| `background/oauth.js:430-433` | "There is a refresh token to renew from only where the server issues one, which it does for `offline_access`; the default scopes do not ask for it" |
| `app-src/src/app/config.ts:176-181` | same reasoning, panel side |
| `ARCHITECTURE.md:184-195` | "In practice the userinfo endpoint is the path" |
| `TESTING.md:326-328`, `:446` | "the panel asks for no `offline_access`, so there is normally no refresh token" |
| `TROUBLESHOOTING.md:96` | "`offline_access` is deliberately not requested for this very reason" |

The record above disproves it: scope `["profile"]`, refresh token present. edu-sharing's own
authorization server issues one without being asked. **The refresh path is the live one**; the
userinfo explanation describes the Doorkeeper/GitLab case (correctly noted at `TESTING.md:340`),
not this one.

How misleading this is, measured: an exploring agent that read only this code concluded "no
refresh token is ever issued" — the exact inference the comments invite.

The correct statement is not "the scope yields no refresh token" but: **whether a refresh token
is issued is the server's decision, not the scope's** — concretely, whether the client
registration carries the `refresh_token` grant. edu-sharing's Spring Authorization Server does
it for `profile`; a Doorkeeper-based one does not.

And the second half of the claim is worse than wrong, it is impossible here: this repository
publishes **no `userinfo_endpoint`**, so the fallback the comments name as the practical path
cannot be taken at all — while the refresh path they dismiss is refused by the token endpoint.
Neither route works. See
[What the refresh token is for](#what-the-refresh-token-is-for--and-why-it-never-works-here).

Note that `scopes: 'profile'` itself is right and stays: `offline_access` is correctly left
unrequested, because a scope the server does not define fails the whole authorization request.
Only the stated reason is wrong.

### 2. `readStoredTokens`' comment contradicts `silentSession`

`background/oauth.js:582` says the access token is stored along "only so a still-valid one can
be reused instead of refreshed". But `silentSession` returns `refresh(...)` unconditionally
whenever a refresh token exists (`:652`), so **a valid access token is never reused**.

What the stored access token is actually for is the userinfo probe in the case where there is
*no* refresh token (`:653-668`, `stillSignedIn` at `:681`).

### 3. `expiresAt` is dead data across the message boundary

Inside the worker it has exactly one use: the guard at `background/oauth.js:653`, in the
else-branch without a refresh token. Beyond that it is handed to the sidebar
(`background/background.js:731`, `:739`) and typed in `OAuthSession`
(`app-src/src/app/services/browser-extension.service.ts:287`) — and read by nobody there
(`oauth.service.ts:171-176` and `:220-225` read `accessToken` only; `OAuthOutcome` at `:26-29`
drops it).

The panel should not read it either: it spends the token immediately, so its remaining lifetime
is not a decision the panel makes.

**Side finding:** the test *"renews a stored access token that has lapsed"*
(`app-src/src/boundary/oauth-flow.spec.ts:730-738`) proves nothing. The login in it yields a
refresh token, so `oauth.js:652` fires and `expiresAt` is never read — the test would be green
with the guard removed. The `expiresAt` guard has no real coverage today.

### 4. An expired access token stays in storage forever

Exactly the observed finding. Once a refresh token exists, `background/oauth.js:653-668` is
unreachable, so the stored `accessToken` and `expiresAt` are **never read again**. What is left
is a bearer credential at rest with no remaining purpose.

Verified: the only readers of `stored.accessToken` / `stored.expiresAt` are `oauth.js:653`,
`:665` and the `stillSignedIn` call at `:668` — all behind the `return refresh(...)` at `:652`.

**Fix:** persist `accessToken` and `expiresAt` only where the server issued **no** refresh
token, which is precisely where the userinfo probe later reads them. The rule belongs in
`storeTokens` (`:594`), not in its two call sites. `refreshToken`, `idToken`, `repository` and
`clientId` stay as they are — `idToken` is needed for `id_token_hint` in `endSessionAt`
(`:526-548`).

---

## Findings 5–7: open, deliberately unchanged

### 5. The "logout must stick" invariant only holds while a panel is alive

`sessionExpired()` (`app-src/src/app/services/auth.service.ts:328`) clears the OAuth tokens
when the repository auto-logs-out, and the comment at `:318-327` states why: otherwise the next
boot silently mints a new repository session from the refresh token — "a timeout that expires
nothing, and a panel the user cannot get logged out of".

But `observeAutoLogout()` (`:315`) only fires in a **live** panel, and the sidebar is destroyed
on every host-page navigation. So: navigate away → the repository session times out
server-side → nobody was there to clear the tokens → on the next open the cookie is gone and
`resumeOAuthSession()` (`:255`) tries to refresh. The invariant the comment asserts holds only
while a panel happens to be open at the moment the timeout is reached.

**Against this repository the hole is currently closed by accident**, because the refresh cannot
succeed (finding 7) — the resume fails and the login card appears, which is what the comment
wanted, for a reason it never mentions. Fix the server side and the hole opens.

Two ways to resolve it, whenever it is taken up:

- **Accept it** — this is what holding a refresh token is for. Then the code stays and
  `sessionExpired()`'s comment must be reduced to what it actually achieves (a logout in a
  running panel), instead of asserting an invariant the panel's death defeats.
- **Enforce it** — the timeout has to outlive the panel. That needs a trace in the worker's
  store: a session deadline written and renewed by the sidebar, which `silentSession()` refuses
  to refresh past.

### 6. No 401 recovery

`revalidate()` (`auth.service.ts:170`) only runs when the settings dialog closes
(`app-src/src/app/services/context-refresh.service.ts:39`). If the repository loses the session
mid-use — a restart, an admin logout — the panel keeps claiming "signed in" and requests simply
fail. As noted above, `ApiInterceptor` inspects no status and there is no `onError` handler.

The resolution would be an interceptor that, on a 401/403 from the repository, tries
`exchangeForSession` once with a freshly refreshed access token and otherwise falls back to the
login card.

---

### 7. The repository refuses the refresh grant, and the extension misreports it *(open)*

Measured above: `grant_type=refresh_token` at this repository's token endpoint answers `302` to
`/edu-sharing/components/login?next=/shibboleth`, so silent resume can never succeed. A
fabricated refresh token gets the same answer, so it is the grant that is refused, not the
token that is stale.

**The server side is not this repo's to fix** — it is the `browser-plugin` client registration
and the security filter chain in the edu-sharing deployment (only `authorization_code` is served
anonymously at that endpoint). What *is* this repo's:

- `refresh()` (`background/oauth.js:460-464`) logs **"the stored session is spent"** for any
  failure, including this one, where nothing was spent. A refusal that never reached grant
  validation deserves to be told apart from an expired grant — the thrown text is
  `OAUTH_TOKEN_FAILED: 405 405`, which names neither.
- It **clears the store** on that failure (`:463`). Correct for a rejected grant; wrong for an
  endpoint that bounced the request, because it throws away a refresh token that was never
  tested and is still the only thing revocation on logout needs.
- A redirect to an HTML login page is a recognisable shape. `fetchJson` already has a branch
  that names a non-JSON body for what it is (`:190`) — it just never runs here, because the
  login component answers `405` with a JSON body and the `!response.ok` branch (`:180-182`)
  fires first with the useless `405 405`. Passing `redirect: 'manual'` for token requests, or
  naming a 3xx explicitly, would turn this from a mystery into a message.
- No `refresh_expires_in` is read either (`toSession`, `:344-356`), so where a server does send
  it (Keycloak), the frontend still cannot tell a spent grant from a refused one.

Nothing here changes what the user sees today — the login card is the right answer either way —
but it is the difference between a diagnosable failure and the silent one that prompted this
document.


## Cross-references

- `ARCHITECTURE.md:111-200` — § The OAuth flow
- `TESTING.md:298-341` (provider fixtures; note `offline_access` in the Keycloak
  `scopes_supported` at `:320`), `:386`, `:446`
- `TROUBLESHOOTING.md:21`, `:58`, `:77`, `:96`
- Tests: `app-src/src/boundary/oauth-flow.spec.ts` (loads `background/oauth.js` against fakes),
  `app-src/src/app/services/oauth.service.spec.ts`, `auth.service.spec.ts`,
  `logout.service.spec.ts`

### Where each lifetime lives, in one table

| Lifetime | Set by | Read by | Effect when it ends |
|---|---|---|---|
| Access token (300 s here) | IdP, `expires_in` → `expiresAt` (`oauth.js:354`) | `oauth.js:653` only, on boot without a refresh token | **None** — no request carries it |
| Refresh token | IdP; its own expiry is neither sent nor read | `oauth.js:436`, `:449` via `silentSession` on boot (**refused here** — finding 7), and `:490-496` to revoke on logout | Boot refresh fails → `clearTokens()` → login card |
| Repository session (cookie) | edu-sharing, reset per API call | the browser, on every request | Panel loses access; `observeAutoLogout` fires *if a panel is open* (see finding 5) |
| IdP SSO session | IdP cookie | `end_session_endpoint` on logout (`oauth.js:526-548`) | Next authorization request asks who is signing in |
