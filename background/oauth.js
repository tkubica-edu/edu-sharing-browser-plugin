// OAuth 2.0 Authorization Code flow with PKCE (RFC 7636), run from the background worker.
//
// The worker rather than the sidebar, for two reasons: the sidebar is an iframe the host page's
// navigation destroys, which would take an in-flight flow with it; and a fetch made here carries the
// extension's host permissions, so the token endpoint is reached without the IdP having to allow the
// extension origin by CORS.
//
// The PKCE pair is generated the way the `pkce-challenge` package does it (MIT, Tom Quirk et al.,
// https://github.com/crouchcd/pkce-challenge): a verifier drawn from the unreserved character set
// with the modulo bias cut off, and its SHA-256 as a base64url challenge. Inlined rather than
// depended on because this file is plain script the worker loads directly — there is no bundler on
// this side of the extension.
//
// Endpoints are neither guessed nor configured: they come from the document the repository publishes
// about its own authorization server (`<repository>/.well-known/oauth-authorization-server`, RFC
// 8414), which is derived from the repository base the panel already works against. So the same code
// serves whatever that repository federates against, and a repository publishing no such document
// has no SSO login at all — which is what leaves the credential form as the way in.

/* global browser */

/** Log prefix, as everywhere else in the extension. */
const OAUTH_LOG = '[edu-sharing][oauth]';

/** Where the tokens of the current OAuth session are kept — see {@link readStoredTokens}. */
const TOKEN_STORAGE_KEY = 'eduSharingOAuthTokens';

/** Verifier length in characters; the maximum RFC 7636 allows, since nothing here pays for it. */
const VERIFIER_LENGTH = 128;

/** How long the user is given to complete the flow before the attempt is abandoned. */
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

/** Timeout for the machine-to-machine calls: discovery, token exchange, refresh, revocation. */
const OAUTH_REQUEST_TIMEOUT_MS = 20000;

/**
 * Seconds subtracted from an access token's lifetime when its expiry is recorded, so a token that is
 * about to lapse counts as lapsed. Covers the round trip the token is then used for.
 */
const EXPIRY_SKEW_S = 30;

/**
 * How long a tab opened only to carry the provider's logout is left standing. Nothing is read off
 * it: the request is the point, and the page it ends on is the provider's own business.
 */
const LOGOUT_TAB_MS = 3000;

/**
 * What the authorization request asks for where the caller names nothing. `profile` alone, because
 * the access token is traded for a repository session rather than read here — no claim of it is
 * inspected, so a wider request would only add scopes the server can refuse.
 *
 * `offline_access` would yield the refresh token a silent resume is best made from, and is left out
 * all the same: the deployments this runs against do not define it, and an undefined scope fails the
 * whole request. {@link silentSession} therefore falls back to the userinfo endpoint. Has to stay in
 * step with `APP_CONFIG.oauth.scopes` in the panel, which states the scopes on every message.
 */
const DEFAULT_SCOPES = 'profile';

/** Metadata documents already fetched, by address — they are static, and the worker outlives a flow. */
const discoveryCache = new Map();

// PKCE

/** The unreserved characters a verifier may consist of (RFC 7636 §4.1). */
const VERIFIER_MASK = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';

/**
 * A cryptographically random string of `size` characters over {@link VERIFIER_MASK}. Bytes at or
 * above the largest multiple of the mask length are discarded rather than folded in: taking the
 * modulo of all 256 would make the first few characters of the mask likelier than the rest.
 */
function randomString(size) {
  const cutoff = 256 - (256 % VERIFIER_MASK.length);
  let result = '';
  while (result.length < size) {
    const bytes = crypto.getRandomValues(new Uint8Array(size - result.length));
    for (const byte of bytes) {
      if (byte < cutoff) result += VERIFIER_MASK[byte % VERIFIER_MASK.length];
    }
  }
  return result;
}

/** base64url of a byte buffer: base64 with the URL-unsafe characters swapped and the padding dropped. */
function base64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/** A verifier and the `S256` challenge derived from it, which is what the authorization request carries. */
async function pkcePair() {
  const verifier = randomString(VERIFIER_LENGTH);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(digest) };
}

// DISCOVERY

/**
 * Where an authorization server publishes its own metadata, relative to the base that fronts it
 * (RFC 8414). The OpenID Connect path (`/.well-known/openid-configuration`) carries the same fields
 * this flow reads, but it is the *provider's* address rather than the repository's — and the
 * repository base is the only address the panel has.
 */
const DISCOVERY_PATH = '/.well-known/oauth-authorization-server';

/** A base URL without its trailing slashes, so a path is appended to it exactly once. */
function normalizeBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

/** Where the repository describes the authorization server the panel signs in against. */
function discoveryUrlOf(repositoryUrl) {
  const base = normalizeBase(repositoryUrl);
  return base ? `${base}${DISCOVERY_PATH}` : '';
}

/**
 * The authorization server's metadata, cached per document address for the worker's lifetime — the
 * document is static, and every step of a flow needs it. Only what this flow uses is taken from it;
 * a document missing the two required endpoints is rejected here rather than at the request that
 * would have used them.
 */
async function discover(repositoryUrl) {
  const url = discoveryUrlOf(repositoryUrl);
  if (!url) throw new Error('OAUTH_NO_REPOSITORY');
  const cached = discoveryCache.get(url);
  if (cached) return cached;

  const document = await fetchJson(url, { method: 'GET' }, 'OAUTH_DISCOVERY_FAILED');
  const endpoints = {
    url,
    // What the server calls itself, for the log; the stored session is identified by the repository
    // it was obtained against, which is what the panel asks in terms of.
    issuer: document.issuer || normalizeBase(repositoryUrl),
    authorization: document.authorization_endpoint,
    token: document.token_endpoint,
    // Where the provider ends its own session — see {@link endSessionAt}.
    endSession: document.end_session_endpoint || null,
    revocation: document.revocation_endpoint || null,
    // Where a token can be held against the provider's own session — see {@link stillSignedIn}.
    userInfo: document.userinfo_endpoint || null,
    // Optional in the spec, so absent is "the server does not say" rather than "no scopes".
    scopesSupported: Array.isArray(document.scopes_supported) ? document.scopes_supported : null,
  };
  if (!endpoints.authorization || !endpoints.token) throw new Error('OAUTH_DISCOVERY_INCOMPLETE');
  discoveryCache.set(url, endpoints);
  console.log(`${OAUTH_LOG} discovered ${url}`);
  return endpoints;
}

/**
 * A JSON request with a timeout, whose failures are reported as `code` rather than as whatever the
 * network said. OAuth error responses carry their reason in the body (RFC 6749 §5.2), so a non-OK
 * answer is read before it is thrown — `invalid_grant` for an expired refresh token is the case that
 * decides whether the user has to be asked again.
 */
async function fetchJson(url, init, code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal, credentials: 'omit' });
  } catch (cause) {
    throw new Error(`${code}: ${cause?.name === 'AbortError' ? 'timeout' : cause?.message || cause}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text().catch(() => '');
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON — the status and the raw text are what there is to report */
  }
  if (!response.ok) {
    const reason = body?.error_description || body?.error || text.slice(0, 200) || response.statusText;
    throw new Error(`${code}: ${response.status} ${reason}`);
  }
  // An empty 2xx body is an answer, not a malformed one: a revocation endpoint (RFC 7009 §2.2)
  // answers 200 with no content, and there is nothing in it a caller wants.
  if (!text.trim()) return {};
  // A body that is there but is not JSON is something else entirely — an address that serves a web
  // page rather than an OAuth endpoint, or a portal in front of it. Reported as such, because the
  // alternative is a caller failing later on a field that was never going to be there.
  if (!body) throw new Error(`${code}: ${response.status} answered ${response.headers?.get?.('content-type') || 'a non-JSON body'}`);
  return body;
}

// REDIRECT TARGET

/**
 * Whether this browser has the `identity` API. Chrome, Edge and Firefox do; Safari does not
 * implement the namespace at all, which is what {@link watchTabForRedirect} exists for. Asked as a
 * feature, not as a browser: the answer is the same question the flow then branches on.
 */
function hasIdentityApi() {
  return typeof browser !== 'undefined' && typeof browser.identity?.launchWebAuthFlow === 'function';
}

/**
 * Whether the `identity` API is what will show the provider's pages for a given redirect address.
 *
 * Having the API is not enough: `launchWebAuthFlow` completes only when the flow reaches the address
 * the browser itself handed out — Chrome watches for `https://<id>.chromiumapp.org/` and nothing else
 * — so any other address has to take the watched-tab path even where the API exists. Without this,
 * such an address would leave the flow hanging on Chrome until the user closed the window, and
 * report that as a cancellation.
 */
function usesIdentityApi(redirect) {
  return hasIdentityApi() && redirect === browser.identity.getRedirectURL();
}

/**
 * The address the IdP sends the user back to, and which must be registered with the client there.
 *
 * With the `identity` API it is the browser's own loopback for this extension
 * (`https://<id>.chromiumapp.org/`, and Firefox's equivalent), which never reaches the network.
 * Without it the redirect has to land on a page the extension can watch a tab navigate to, so an
 * ordinary https address is used: a path on the repository itself. Nothing needs to be served there —
 * the flow reads the authorization code off the address and closes the tab before the page has a
 * chance to load.
 */
function redirectUri({ repositoryUrl } = {}) {
  if (hasIdentityApi()) return browser.identity.getRedirectURL();
  const base = normalizeBase(repositoryUrl);
  if (!base) throw new Error('OAUTH_NO_REDIRECT_URI');
  return `${base}/oauth/extension-callback`;
}

// THE INTERACTIVE STEP

/**
 * Show the IdP's pages and answer with the address it finally redirected to. `identity` where there
 * is one, a watched tab where there is not; both hand back the same thing, so the flow around them
 * does not know which ran.
 */
async function authorize(authorizationUrl, redirect) {
  if (usesIdentityApi(redirect)) {
    // Only `url` and `interactive`. Chrome validates `WebAuthFlowDetails` against its own schema and
    // rejects any property outside it — a `redirect_uri` here is a hard error, not an ignored hint —
    // and Firefox needs none: the parameter was required only between Firefox 75 and 86, well below
    // the 128 this extension declares as its minimum. Both browsers take the address from the
    // authorization URL, where the flow has already put it.
    const result = await browser.identity.launchWebAuthFlow({ url: authorizationUrl, interactive: true });
    if (!result) throw new Error('OAUTH_CANCELLED');
    return result;
  }
  return watchTabForRedirect(authorizationUrl, redirect);
}

/**
 * The `identity`-less flow: open the IdP in a tab and resolve as soon as that tab heads for the
 * redirect address. Matched on the address alone, before the load finishes, so the page behind it is
 * never fetched and never has to exist. The tab is closed either way — on the redirect, and on the
 * timeout — and a tab the user closes themselves is a cancellation, which is a normal outcome rather
 * than an error to report.
 */
function watchTabForRedirect(authorizationUrl, redirect) {
  return new Promise((resolve, reject) => {
    let authTabId = null;
    let settled = false;

    const stop = () => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
    };

    /** Resolve or reject once, tearing down the listeners and the tab the flow opened. */
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      stop();
      if (authTabId !== null) browser.tabs.remove(authTabId).catch(() => {});
      fn(value);
    };

    const timer = setTimeout(() => settle(reject, new Error('OAUTH_TIMEOUT')), FLOW_TIMEOUT_MS);

    // `changeInfo.url` is not set on every event Safari emits for a navigation, so the tab's own url
    // is the fallback — one of the two carries it by the time the redirect is under way.
    function onUpdated(tabId, changeInfo, tab) {
      if (tabId !== authTabId) return;
      const url = changeInfo.url || tab?.url || '';
      if (url && url.startsWith(redirect)) settle(resolve, url);
    }

    function onRemoved(tabId) {
      if (tabId !== authTabId) return;
      // The tab is already gone; nulling it keeps `settle` from asking for it to be removed again.
      authTabId = null;
      settle(reject, new Error('OAUTH_CANCELLED'));
    }

    browser.tabs.onUpdated.addListener(onUpdated);
    browser.tabs.onRemoved.addListener(onRemoved);
    browser.tabs
      .create({ url: authorizationUrl, active: true })
      .then((tab) => {
        authTabId = tab.id;
        // The redirect can have happened while the tab was being created — an IdP that already has a
        // session answers the authorization request immediately, and that navigation may predate the
        // listener above.
        if (tab.url && tab.url.startsWith(redirect)) settle(resolve, tab.url);
      })
      .catch((cause) => settle(reject, new Error(`OAUTH_TAB_FAILED: ${cause?.message || cause}`)));
  });
}

// THE FLOW

/**
 * What the IdP put on the redirect address. Read from the query string and from the fragment alike:
 * the code flow answers in the query, but an IdP configured for a different response mode answers in
 * the fragment, and reading both costs nothing. An `error` there is the IdP's own refusal and is
 * reported with the description it gave.
 */
function parseCallback(url, expectedState) {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  for (const [key, value] of new URLSearchParams(parsed.hash.replace(/^#/, ''))) {
    if (!params.has(key)) params.set(key, value);
  }

  const error = params.get('error');
  if (error) {
    const description = params.get('error_description');
    throw new Error(`OAUTH_REFUSED: ${error}${description ? ` (${description})` : ''}`);
  }
  // The state is what ties the answer to the request this flow made (RFC 6749 §10.12). A mismatch is
  // not a failed login but a foreign response, so it is refused without looking at the code.
  if (params.get('state') !== expectedState) throw new Error('OAUTH_STATE_MISMATCH');
  const code = params.get('code');
  if (!code) throw new Error('OAUTH_NO_CODE');
  return code;
}

/** The token endpoint's answer, normalized to what the sidebar and the store need. */
function toSession(payload, previousRefreshToken = null) {
  const accessToken = payload.access_token;
  if (!accessToken) throw new Error('OAUTH_NO_ACCESS_TOKEN');
  const lifetime = Number(payload.expires_in);
  return {
    accessToken,
    // An IdP that rotates refresh tokens sends a new one; one that does not sends none, and the
    // token already held stays valid — dropping it here would end the session at the first refresh.
    refreshToken: payload.refresh_token || previousRefreshToken,
    idToken: payload.id_token || null,
    expiresAt: Number.isFinite(lifetime) ? Date.now() + Math.max(0, lifetime - EXPIRY_SKEW_S) * 1000 : null,
  };
}

/** A form-encoded POST to the token endpoint. No client secret: this is a public client. */
function postToken(endpoint, params) {
  return fetchJson(
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    },
    'OAUTH_TOKEN_FAILED',
  );
}

/**
 * Run the whole interactive flow and answer with the session it produced, which is also stored.
 * `loginHint` and `registrationId` are passed through where given: edu-sharing names the identity
 * provider behind its authorization server by `kc_idp_hint`-style registration id, which is what its
 * `oauthEntries` advertise.
 */
async function login({ repositoryUrl, clientId, scopes, registrationId, loginHint } = {}) {
  if (!clientId) throw new Error('OAUTH_NO_CLIENT_ID');
  const endpoints = await discover(repositoryUrl);
  const redirect = redirectUri({ repositoryUrl });
  const { verifier, challenge } = await pkcePair();
  const state = randomString(32);
  const nonce = randomString(32);

  const request = new URL(endpoints.authorization);
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    scope: String(scopes || DEFAULT_SCOPES),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  if (registrationId) query.set('kc_idp_hint', registrationId);
  if (loginHint) query.set('login_hint', loginHint);
  // Merged rather than assigned: a server whose authorization endpoint already carries parameters
  // of its own would otherwise lose them.
  for (const [key, value] of query) request.searchParams.set(key, value);

  // Logged in full because a provider that refuses the request renders its own error page and tells
  // the extension nothing — this line is then the only record of what was actually asked for. Safe
  // to log: the challenge is a hash and the state is single-use. The verifier is the secret here and
  // is deliberately absent.
  console.log(
    `${OAUTH_LOG} authorizing via ${usesIdentityApi(redirect) ? 'identity API' : 'watched tab'}:`,
    request.toString(),
  );
  const code = parseCallback(await authorize(request.toString(), redirect), state);

  const session = toSession(
    await postToken(endpoints.token, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
    }),
  );
  await storeTokens({ ...session, repository: normalizeBase(repositoryUrl), clientId });
  return session;
}

/**
 * Renew the session from the stored refresh token, without showing anything. Answers null where there
 * is nothing to renew from — no stored token, or one belonging to a different repository or client
 * than the one now in use — so a caller can tell "nobody is signed in" from "the renewal failed".
 * A refresh the IdP rejects clears the store: that token will not start working again.
 *
 * There is a refresh token to renew from only where the server issues one, which it does for
 * `offline_access`; the default scopes do not ask for it, and this then finds nothing to do.
 */
async function refresh({ repositoryUrl, clientId } = {}) {
  const stored = await readStoredTokens();
  if (!stored?.refreshToken) return null;
  const wanted = normalizeBase(repositoryUrl);
  if (!belongsTo(stored, wanted, clientId)) {
    console.log(`${OAUTH_LOG} stored session belongs to another client — discarding`);
    await clearTokens();
    return null;
  }

  const endpoints = await discover(wanted || stored.repository);
  try {
    const session = toSession(
      await postToken(endpoints.token, {
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
        client_id: clientId || stored.clientId,
      }),
      stored.refreshToken,
    );
    await storeTokens({
      ...session,
      repository: wanted || stored.repository,
      clientId: clientId || stored.clientId,
    });
    return session;
  } catch (cause) {
    console.warn(`${OAUTH_LOG} refresh failed — the stored session is spent:`, cause?.message || cause);
    await clearTokens();
    throw cause;
  }
}

/**
 * Drop the OAuth session, in all three places it exists. The store is cleared first and
 * unconditionally: whether the provider could be told is not allowed to decide whether this
 * extension still holds a credential. Telling it is then best-effort, and two separate things —
 * revoking the token so it stops working for anyone who got hold of it, and ending the provider's
 * own session so the next sign-in asks who is signing in (see {@link endSessionAt}). Either is done
 * only where the metadata names an endpoint for it, which is what the two flags report.
 */
async function logout({ repositoryUrl, clientId } = {}) {
  const stored = await readStoredTokens();
  await clearTokens();
  if (!stored) return { revoked: false, sessionEnded: false };

  const repository = normalizeBase(repositoryUrl) || stored.repository;
  let endpoints;
  try {
    endpoints = await discover(repository);
  } catch (cause) {
    console.warn(`${OAUTH_LOG} cannot reach the provider (session is dropped locally anyway):`, cause?.message || cause);
    return { revoked: false, sessionEnded: false };
  }

  let revoked = false;
  if (endpoints.revocation && stored.refreshToken) {
    try {
      await postToken(endpoints.revocation, {
        token: stored.refreshToken,
        token_type_hint: 'refresh_token',
        client_id: clientId || stored.clientId,
      });
      revoked = true;
    } catch (cause) {
      console.warn(`${OAUTH_LOG} revocation failed (session is dropped locally anyway):`, cause?.message || cause);
    }
  }

  const sessionEnded = endpoints.endSession
    ? await endSessionAt(endpoints.endSession, {
        clientId: clientId || stored.clientId,
        idToken: stored.idToken,
      })
    : false;
  return { revoked, sessionEnded };
}

/**
 * Drive the provider's own logout, where its metadata names one (`end_session_endpoint`, OpenID
 * Connect RP-Initiated Logout). Dropping the tokens is not enough on its own: the provider's session
 * cookie outlives them, and the next authorization request is then answered straight from that
 * cookie — a logout after which the same user is silently signed back in.
 *
 * The request has to carry the browser's cookies to be about that session at all, so it is driven
 * through the browser rather than by `fetch`: non-interactively through the `identity` API where
 * there is one, and in a background tab that closes itself where there is not. No
 * `post_logout_redirect_uri` is sent, because a provider accepts only addresses registered with the
 * client and an unregistered one turns the logout into an error page — so nothing here waits for a
 * redirect that is not coming. What is reported is therefore that the provider was asked, which is
 * as much as either browser says.
 */
async function endSessionAt(endpoint, { clientId, idToken } = {}) {
  const request = new URL(endpoint);
  // Which session to end. `id_token_hint` is the one the spec asks for and is present only where the
  // scopes yielded an id token; `client_id` is what a provider falls back to.
  if (idToken) request.searchParams.set('id_token_hint', idToken);
  if (clientId) request.searchParams.set('client_id', clientId);
  const url = request.toString();

  try {
    if (hasIdentityApi()) {
      // Ends in a rejection once the page it lands on is not a redirect it can follow, which is the
      // ordinary outcome here — the logout has been performed by then.
      await browser.identity.launchWebAuthFlow({ url, interactive: false });
    } else {
      const tab = await browser.tabs.create({ url, active: false });
      setTimeout(() => browser.tabs.remove(tab.id).catch(() => {}), LOGOUT_TAB_MS);
    }
  } catch {
    /* see above: neither browser reports the provider's answer, only that nothing redirected */
  }
  console.log(`${OAUTH_LOG} asked the provider to end its session: ${endpoint}`);
  return true;
}

/**
 * What the repository says about its authorization server, without starting a flow. Asked before
 * anything else: whether that document is there at all is what decides whether the SSO login is
 * offered, since a repository that publishes none federates against nothing (see OAuthService).
 *
 * `unsupportedScopes` is the one a deployment gets wrong in practice and cannot see coming — a
 * server that does not define a requested scope answers the authorization request with
 * `invalid_scope`, and does so on a page of its own rather than by redirecting, so the panel would
 * never learn why. Naming it here turns that into a sentence before anybody tries to sign in.
 */
async function metadata({ repositoryUrl, scopes } = {}) {
  const endpoints = await discover(repositoryUrl);
  const wanted = String(scopes || DEFAULT_SCOPES).split(/\s+/).filter(Boolean);
  return {
    discoveryUrl: endpoints.url,
    issuer: endpoints.issuer,
    revocable: !!endpoints.revocation,
    sessionEndable: !!endpoints.endSession,
    scopesSupported: endpoints.scopesSupported,
    // Empty where the server lists none: nothing is known to be wrong, which is not the same as
    // everything being right, and the caller says so.
    unsupportedScopes: endpoints.scopesSupported
      ? wanted.filter((scope) => !endpoints.scopesSupported.includes(scope))
      : [],
  };
}

// TOKEN STORE

/**
 * The stored session, or null. `storage.local` rather than `storage.session`, which is what makes the
 * refresh token outlive the browser and the sidebar being closed — the point of holding one at all.
 * The access token is stored with it only so a still-valid one can be reused instead of refreshed;
 * it is the refresh token that matters here.
 */
async function readStoredTokens() {
  try {
    const items = await browser.storage.local.get({ [TOKEN_STORAGE_KEY]: null });
    return items[TOKEN_STORAGE_KEY] || null;
  } catch {
    return null;
  }
}

async function storeTokens(tokens) {
  try {
    await browser.storage.local.set({ [TOKEN_STORAGE_KEY]: tokens });
  } catch (cause) {
    // Not fatal: the session just obtained is usable, it only will not survive the sidebar closing.
    console.warn(`${OAUTH_LOG} could not persist the session:`, cause?.message || cause);
  }
}

async function clearTokens() {
  try {
    await browser.storage.local.remove(TOKEN_STORAGE_KEY);
  } catch {
    /* nothing stored, or no storage — either way there is nothing left to clear */
  }
}

/**
 * Whether a stored session was obtained against the repository and client now in use. A session says
 * which pair it came from, and the panel may have been pointed elsewhere since — a token from the
 * previous repository's provider is not a session against this one, however unexpired it is. A
 * stored session naming neither is taken as belonging: it predates the fields, and the refresh will
 * settle it.
 */
function belongsTo(stored, repository, clientId) {
  if (repository && stored.repository && stored.repository !== repository) return false;
  return !(clientId && stored.clientId && stored.clientId !== clientId);
}

/**
 * A usable access token without asking the user, for putting a lost repository session back on a
 * boot (`AuthService.resumeOAuthSession`). Null where nobody is signed in.
 *
 * The stored access token is **not** taken as evidence on its own, however far its `expiresAt` still
 * is away. Nothing outside this extension can reach that store: signing out of edu-sharing's own
 * pages does not clear it, and neither does signing out at the provider — so a token trusted for its
 * nominal lifetime would keep minting fresh repository sessions for a user who has logged out
 * everywhere they can see, which is a panel that cannot be logged out of.
 *
 * So the provider is asked, every time, and only its answer is trusted: a refresh where there is a
 * refresh token (the grant it invalidates on logout), else the token held against its userinfo
 * endpoint (see {@link stillSignedIn}). Where neither can be done — no refresh token and no such
 * endpoint — nothing is resumed, because there is then no way to tell a live session from a logged-out
 * one, and the login card is the honest answer.
 */
async function silentSession({ repositoryUrl, clientId } = {}) {
  const stored = await readStoredTokens();
  if (!stored) return null;
  const wanted = normalizeBase(repositoryUrl);
  // Without this a token from the provider of a repository the panel has since left would be handed
  // out for as long as it happened to stay valid.
  if (!belongsTo(stored, wanted, clientId)) {
    console.log(`${OAUTH_LOG} stored session belongs to another client — discarding`);
    await clearTokens();
    return null;
  }
  // A refresh is the stronger check of the two — the provider validates the grant *and* answers with
  // a fresh token — so it is preferred wherever there is a refresh token to make it with.
  if (stored.refreshToken) return refresh({ repositoryUrl, clientId });
  if (!stored.accessToken || !stored.expiresAt || stored.expiresAt <= Date.now()) return null;

  let endpoints;
  try {
    endpoints = await discover(wanted || stored.repository);
  } catch (cause) {
    console.warn(`${OAUTH_LOG} cannot reach the provider to check the stored session:`, cause?.message || cause);
    return null;
  }
  if (!(await stillSignedIn(endpoints, stored.accessToken))) return null;
  return {
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    idToken: stored.idToken,
    expiresAt: stored.expiresAt,
  };
}

/**
 * Whether the provider still holds the session the stored access token was issued for. Asked at the
 * userinfo endpoint, which answers for the *session* rather than for the token's signature: a
 * provider that ended the session refuses it (401/403) while the token itself is still inside its
 * nominal lifetime, and that difference is the whole point of asking.
 *
 * A refusal clears the store — that session is over and no later boot should try again. Anything else
 * (no such endpoint, the provider unreachable, an answer that is neither) leaves the store alone and
 * reports "cannot say", which stops the resume without throwing the token away over a network blip.
 */
async function stillSignedIn(endpoints, accessToken) {
  if (!endpoints.userInfo) {
    console.log(`${OAUTH_LOG} the provider names no userinfo endpoint — not resuming from a stored token`);
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(endpoints.userInfo, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      credentials: 'omit',
      signal: controller.signal,
    });
  } catch (cause) {
    console.warn(`${OAUTH_LOG} could not check the stored session:`, cause?.name === 'AbortError' ? 'timeout' : cause?.message || cause);
    return false;
  } finally {
    clearTimeout(timer);
  }
  if (response.ok) return true;
  if (response.status === 401 || response.status === 403) {
    console.log(`${OAUTH_LOG} the provider has ended that session (${response.status}) — dropping the stored one`);
    await clearTokens();
    return false;
  }
  console.warn(`${OAUTH_LOG} the userinfo endpoint answered ${response.status} — not resuming`);
  return false;
}

self.EDU_SHARING_OAUTH = {
  login,
  refresh,
  logout,
  silentSession,
  redirectUri,
  metadata,
  hasIdentityApi,
  usesIdentityApi,
  TOKEN_STORAGE_KEY,
};
