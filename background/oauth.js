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
// Endpoints are never guessed: they come from the issuer's OpenID Connect discovery document, so the
// same code serves Keycloak, Shibboleth or edu-sharing's own authorization server.

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

/** What is asked for when nothing else is configured; `offline_access` is what yields a refresh token. */
const DEFAULT_SCOPES = 'openid profile email offline_access';

/** Discovery documents already fetched, by issuer — they are static, and the worker outlives a flow. */
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

/** The issuer without a trailing slash, so the well-known path is appended to it exactly once. */
function normalizeIssuer(issuer) {
  return String(issuer || '').trim().replace(/\/+$/, '');
}

/**
 * The issuer's OpenID Connect metadata (`/.well-known/openid-configuration`), cached per issuer.
 * Only the endpoints this flow uses are taken from it; a document missing the two required ones is
 * rejected here rather than at the request that would have used them.
 */
async function discover(issuer) {
  const base = normalizeIssuer(issuer);
  if (!base) throw new Error('OAUTH_NO_ISSUER');
  const cached = discoveryCache.get(base);
  if (cached) return cached;

  const url = `${base}/.well-known/openid-configuration`;
  const document = await fetchJson(url, { method: 'GET' }, 'OAUTH_DISCOVERY_FAILED');
  const endpoints = {
    authorization: document.authorization_endpoint,
    token: document.token_endpoint,
    endSession: document.end_session_endpoint || null,
    revocation: document.revocation_endpoint || null,
    // Optional in the spec, so absent is "the issuer does not say" rather than "no scopes".
    scopesSupported: Array.isArray(document.scopes_supported) ? document.scopes_supported : null,
  };
  if (!endpoints.authorization || !endpoints.token) throw new Error('OAUTH_DISCOVERY_INCOMPLETE');
  discoveryCache.set(base, endpoints);
  console.log(`${OAUTH_LOG} discovered ${base}`);
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
 * — so a deployment that configures an address of its own has to take the watched-tab path even where
 * the API exists. Without this, a configured address would leave the flow hanging on Chrome until the
 * user closed the window, and report that as a cancellation.
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
 * ordinary https address is used — the configured one, else a path on the repository itself. Nothing
 * needs to be served there: the flow reads the authorization code off the address and closes the tab
 * before the page has a chance to load.
 */
function redirectUri({ configuredRedirectUri, repositoryUrl } = {}) {
  const configured = String(configuredRedirectUri || '').trim();
  if (configured) return configured;
  if (hasIdentityApi()) return browser.identity.getRedirectURL();
  const base = String(repositoryUrl || '').trim().replace(/\/+$/, '');
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
async function login({ issuer, clientId, scopes, configuredRedirectUri, repositoryUrl, registrationId, loginHint } = {}) {
  if (!clientId) throw new Error('OAUTH_NO_CLIENT_ID');
  const endpoints = await discover(issuer);
  const redirect = redirectUri({ configuredRedirectUri, repositoryUrl });
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
  // Merged rather than assigned: an issuer whose authorization endpoint already carries parameters
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
  await storeTokens({ ...session, issuer: normalizeIssuer(issuer), clientId });
  return session;
}

/**
 * Renew the session from the stored refresh token, without showing anything. Answers null where there
 * is nothing to renew from — no stored token, or one belonging to a different issuer or client than
 * the one now configured — so a caller can tell "nobody is signed in" from "the renewal failed".
 * A refresh the IdP rejects clears the store: that token will not start working again.
 */
async function refresh({ issuer, clientId } = {}) {
  const stored = await readStoredTokens();
  if (!stored?.refreshToken) return null;
  const wanted = normalizeIssuer(issuer);
  if (!belongsTo(stored, wanted, clientId)) {
    console.log(`${OAUTH_LOG} stored session belongs to another client — discarding`);
    await clearTokens();
    return null;
  }

  const endpoints = await discover(wanted || stored.issuer);
  try {
    const session = toSession(
      await postToken(endpoints.token, {
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
        client_id: clientId || stored.clientId,
      }),
      stored.refreshToken,
    );
    await storeTokens({ ...session, issuer: wanted || stored.issuer, clientId: clientId || stored.clientId });
    return session;
  } catch (cause) {
    console.warn(`${OAUTH_LOG} refresh failed — the stored session is spent:`, cause?.message || cause);
    await clearTokens();
    throw cause;
  }
}

/**
 * Drop the OAuth session. The store is cleared first and unconditionally: whether the IdP could be
 * told is not allowed to decide whether this extension still holds a credential. Telling it is then
 * best-effort — the revocation endpoint where the issuer has one, so the refresh token stops working
 * for anyone who did get hold of it.
 */
async function logout({ issuer, clientId } = {}) {
  const stored = await readStoredTokens();
  await clearTokens();
  if (!stored?.refreshToken) return { revoked: false };

  const base = normalizeIssuer(issuer) || stored.issuer;
  try {
    const endpoints = await discover(base);
    if (!endpoints.revocation) return { revoked: false };
    await postToken(endpoints.revocation, {
      token: stored.refreshToken,
      token_type_hint: 'refresh_token',
      client_id: clientId || stored.clientId,
    });
    return { revoked: true };
  } catch (cause) {
    console.warn(`${OAUTH_LOG} revocation failed (session is dropped locally anyway):`, cause?.message || cause);
    return { revoked: false };
  }
}

/**
 * Ask the issuer what it is, without starting a flow: whether it can be reached, whether it
 * describes the endpoints the flow needs, and which of the configured scopes it does not define.
 *
 * The last is the one a deployment gets wrong in practice and cannot see coming — a provider that
 * does not define `offline_access` (Doorkeeper-based ones, GitLab among them) answers the
 * authorization request with `invalid_scope`, and does so on a page of its own rather than by
 * redirecting, so the panel never learns why. Checking it here turns that into a sentence in the
 * settings before anybody tries to sign in.
 */
async function checkIssuer({ issuer, scopes } = {}) {
  const endpoints = await discover(issuer);
  const wanted = String(scopes || DEFAULT_SCOPES).split(/\s+/).filter(Boolean);
  return {
    revocable: !!endpoints.revocation,
    scopesSupported: endpoints.scopesSupported,
    // Empty where the issuer lists none: nothing is known to be wrong, which is not the same as
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
 * Whether a stored session was obtained for the client now configured. A session says which issuer
 * and client it came from, and the settings may name others since — a token from the previous
 * provider is not a session against this one, however unexpired it is. A stored session naming
 * neither is taken as belonging: it predates the fields, and the refresh will settle it.
 */
function belongsTo(stored, wantedIssuer, clientId) {
  if (wantedIssuer && stored.issuer && stored.issuer !== wantedIssuer) return false;
  return !(clientId && stored.clientId && stored.clientId !== clientId);
}

/**
 * A usable access token without asking the user: the stored one while it is still valid, else what a
 * refresh yields. Null where nobody is signed in.
 */
async function silentSession({ issuer, clientId } = {}) {
  const stored = await readStoredTokens();
  // The same check the refresh makes — without it a token from a provider the settings have since
  // moved away from would be handed out for as long as it happened to stay valid.
  if (
    stored?.accessToken &&
    stored.expiresAt &&
    stored.expiresAt > Date.now() &&
    belongsTo(stored, normalizeIssuer(issuer), clientId)
  ) {
    return { accessToken: stored.accessToken, refreshToken: stored.refreshToken, idToken: stored.idToken, expiresAt: stored.expiresAt };
  }
  return refresh({ issuer, clientId });
}

self.EDU_SHARING_OAUTH = {
  login,
  refresh,
  logout,
  silentSession,
  redirectUri,
  checkIssuer,
  hasIdentityApi,
  usesIdentityApi,
  TOKEN_STORAGE_KEY,
};
