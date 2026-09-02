import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The OAuth/PKCE flow the background worker runs (`background/oauth.js`).
 *
 * That file is plain script the worker loads directly — it exports nothing and assigns to `self`, so
 * it is evaluated here in a sandbox rather than imported, the way the extension contract spec reads
 * the worker's other files. What it needs from around it is handed in: a `browser` with the two APIs
 * the flow branches on, and a `fetch` standing in for the identity provider.
 *
 * Worth testing at this level because none of it is reachable from the panel: the PKCE pair, the
 * state check and the redirect matching are where a mistake either breaks every login or, worse,
 * accepts an answer it should not.
 */

/** The repo root, found from the working directory — `npm test` runs from either it or `app-src`. */
function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'manifest.base.json'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('no repo root above ' + process.cwd());
    dir = parent;
  }
  return dir;
}

const SOURCE = readFileSync(join(repoRoot(), 'background/oauth.js'), 'utf8');

/**
 * The repository every case here signs in against, and where it publishes what it federates with
 * (RFC 8414). The endpoints in that document are the identity provider's own and sit elsewhere
 * entirely, which is what proves they are read rather than assembled.
 */
const REPOSITORY = 'https://repo.example/edu-sharing';
const METADATA_URL = `${REPOSITORY}/.well-known/oauth-authorization-server`;
const CLIENT_ID = 'browser-plugin';
const AUTHORIZATION_ENDPOINT = 'https://sso.example/realms/edu/protocol/openid-connect/auth';
const TOKEN_ENDPOINT = 'https://sso.example/realms/edu/protocol/openid-connect/token';
const REVOCATION_ENDPOINT = 'https://sso.example/realms/edu/protocol/openid-connect/revoke';
const END_SESSION_ENDPOINT = 'https://sso.example/realms/edu/protocol/openid-connect/logout';

/** The address Chrome's and Firefox's `identity` API hands out for this extension. */
const IDENTITY_REDIRECT = 'https://abcdef.chromiumapp.org/';

interface OAuthModule {
  login(request: Record<string, unknown>): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: number | null }>;
  refresh(request: Record<string, unknown>): Promise<{ accessToken: string } | null>;
  logout(request: Record<string, unknown>): Promise<{ revoked: boolean; sessionEnded: boolean }>;
  silentSession(request: Record<string, unknown>): Promise<{ accessToken: string } | null>;
  redirectUri(request: Record<string, unknown>): string;
  hasIdentityApi(): boolean;
  metadata(request: Record<string, unknown>): Promise<{
    discoveryUrl: string;
    issuer: string;
    revocable: boolean;
    sessionEndable: boolean;
    scopesSupported: string[] | null;
    unsupportedScopes: string[];
  }>;
  usesIdentityApi(redirect: string): boolean;
  TOKEN_STORAGE_KEY: string;
}

describe('the worker`s OAuth flow', () => {
  /** Stands in for `storage.local`, which is where the refresh token is kept between sessions. */
  let stored: Map<string, unknown>;
  /** Every request the flow made, so a case can assert on what it sent rather than only on the answer. */
  let requests: { url: string; body: URLSearchParams | null }[];
  /** What `launchWebAuthFlow` / the watched tab ends up at; a spec sets it per case. */
  let redirectedTo: (authorizationUrl: string) => string | Promise<string>;
  /** The tabs the watched-tab fallback opened, and the ones it closed again. */
  let createdTabs: { id: number; url: string }[];
  let removedTabs: number[];
  /** Set for the cases that exercise the `identity`-less path. */
  let withoutIdentityApi = false;
  /** Listeners the fallback registered, so a case can drive a navigation by hand. */
  let updateListeners: ((tabId: number, changeInfo: { url?: string }, tab: { url?: string }) => void)[];
  let removeListeners: ((tabId: number) => void)[];

  /**
   * The discovery document the issuer answers with; a case can leave endpoints out of it or add the
   * scope list. Values are strings or lists of them, which is what the document itself holds.
   */
  let discovery: Record<string, string | string[]>;
  /** Set by the case that asserts on what `launchWebAuthFlow` was handed. */
  let launchedOptions: Record<string, unknown>[] | null;

  /**
   * Load `background/oauth.js` with the globals it expects. A fresh module per case, because it caches
   * discovery documents for the worker's whole lifetime.
   */
  function loadModule(): OAuthModule {
    const self: { EDU_SHARING_OAUTH?: OAuthModule } = {};
    new Function('self', 'browser', 'fetch', 'console', SOURCE)(
      self,
      fakeBrowser(),
      fakeFetch,
      { log: () => undefined, warn: () => undefined, error: () => undefined },
    );
    if (!self.EDU_SHARING_OAUTH) throw new Error('background/oauth.js assigned no EDU_SHARING_OAUTH');
    return self.EDU_SHARING_OAUTH;
  }

  function fakeBrowser() {
    let nextTabId = 1;
    return {
      identity: withoutIdentityApi
        ? undefined
        : {
            getRedirectURL: () => IDENTITY_REDIRECT,
            launchWebAuthFlow: async (options: { url: string }) => {
              launchedOptions?.push(options);
              return redirectedTo(options.url);
            },
          },
      tabs: {
        create: async ({ url }: { url: string }) => {
          const tab = { id: nextTabId++, url };
          createdTabs.push(tab);
          return tab;
        },
        remove: async (tabId: number) => {
          removedTabs.push(tabId);
        },
        onUpdated: {
          addListener: (fn: (typeof updateListeners)[number]) => updateListeners.push(fn),
          removeListener: (fn: (typeof updateListeners)[number]) => {
            updateListeners = updateListeners.filter((listener) => listener !== fn);
          },
        },
        onRemoved: {
          addListener: (fn: (typeof removeListeners)[number]) => removeListeners.push(fn),
          removeListener: (fn: (typeof removeListeners)[number]) => {
            removeListeners = removeListeners.filter((listener) => listener !== fn);
          },
        },
      },
      storage: {
        local: {
          get: async (defaults: Record<string, unknown>) => {
            const [key] = Object.keys(defaults);
            return { [key]: stored.has(key) ? stored.get(key) : defaults[key] };
          },
          set: async (items: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(items)) stored.set(key, value);
          },
          remove: async (key: string) => {
            stored.delete(key);
          },
        },
      },
    };
  }

  /** The identity provider: its discovery document, its token endpoint and its revocation endpoint. */
  const fakeFetch = vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? new URLSearchParams(init.body) : null;
    requests.push({ url, body });

    // Only this repository describes an authorization server; any other is a host with nothing at
    // that path, which is what the flow has to report rather than assume endpoints for.
    if (url === METADATA_URL) return jsonResponse(discovery);
    if (url === TOKEN_ENDPOINT) {
      if (body?.get('grant_type') === 'refresh_token') {
        return jsonResponse({ access_token: 'a-renewed-token', refresh_token: 'a-rotated-refresh-token', expires_in: 300 });
      }
      return jsonResponse({ access_token: 'an-access-token', refresh_token: 'a-refresh-token', expires_in: 300 });
    }
    if (url === REVOCATION_ENDPOINT) return jsonResponse({});
    return jsonResponse({ error: 'not_found' }, 404);
  });

  function jsonResponse(payload: unknown, status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: async () => JSON.stringify(payload),
    };
  }

  /** The parameters every case signs in with — the repository, and the client the panel ships with. */
  const request = { repositoryUrl: REPOSITORY, clientId: CLIENT_ID };

  beforeEach(() => {
    stored = new Map();
    requests = [];
    createdTabs = [];
    removedTabs = [];
    updateListeners = [];
    removeListeners = [];
    withoutIdentityApi = false;
    launchedOptions = null;
    discovery = {
      issuer: 'https://sso.example/realms/edu',
      authorization_endpoint: AUTHORIZATION_ENDPOINT,
      token_endpoint: TOKEN_ENDPOINT,
      revocation_endpoint: REVOCATION_ENDPOINT,
    };
    // The IdP redirects straight back with the code, echoing the state it was given — the happy path
    // every case that is not about the redirect itself starts from.
    redirectedTo = (authorizationUrl) => {
      const state = new URL(authorizationUrl).searchParams.get('state');
      return `${IDENTITY_REDIRECT}?code=an-auth-code&state=${state}`;
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    fakeFetch.mockClear();
  });

  /** The authorization request the flow sent the user to. */
  function authorizationRequest(): URL {
    const sent = createdTabs.at(0)?.url ?? lastLaunchedUrl;
    if (!sent) throw new Error('no authorization request was made');
    return new URL(sent);
  }

  /** Recorded for the `identity` path, which does not open a tab to read the address off. */
  let lastLaunchedUrl: string | null = null;
  beforeEach(() => {
    lastLaunchedUrl = null;
    const answer = redirectedTo;
    redirectedTo = (authorizationUrl) => {
      lastLaunchedUrl = authorizationUrl;
      return answer(authorizationUrl);
    };
  });

  describe('the authorization request', () => {
    it('carries an S256 challenge and no client secret', async () => {
      await loadModule().login(request);
      const query = authorizationRequest().searchParams;

      expect(query.get('response_type')).toBe('code');
      expect(query.get('code_challenge_method')).toBe('S256');
      expect(query.get('client_id')).toBe(CLIENT_ID);
      // base64url of a SHA-256: 43 characters, and none of base64's three unsafe ones.
      expect(query.get('code_challenge')).toMatch(/^[A-Za-z0-9\-_]{43}$/);
      expect(query.get('client_secret')).toBeNull();
    });

    it('sends the verifier only to the token endpoint, never to the authorization one', async () => {
      await loadModule().login(request);

      // The point of PKCE: what travels through the browser is the hash, the secret follows
      // out-of-band. A verifier in the address bar would make the challenge pointless.
      expect(authorizationRequest().searchParams.get('code_verifier')).toBeNull();
      const exchange = requests.find((sent) => sent.body?.get('grant_type') === 'authorization_code');
      expect(exchange?.body?.get('code_verifier')).toMatch(/^[A-Za-z0-9\-._~]{128}$/);
    });

    it('draws a fresh verifier and state for every attempt', async () => {
      const module = loadModule();
      await module.login(request);
      const first = authorizationRequest().searchParams;
      const firstChallenge = first.get('code_challenge');
      const firstState = first.get('state');

      createdTabs = [];
      await module.login(request);
      const second = authorizationRequest().searchParams;

      expect(second.get('code_challenge')).not.toBe(firstChallenge);
      expect(second.get('state')).not.toBe(firstState);
    });

    it('names the identity provider to go straight to, where one was picked', async () => {
      await loadModule().login({ ...request, registrationId: 'uni' });

      expect(authorizationRequest().searchParams.get('kc_idp_hint')).toBe('uni');
    });

    it('keeps the parameters an issuer put on its own authorization endpoint', async () => {
      discovery.authorization_endpoint = `${AUTHORIZATION_ENDPOINT}?tenant=schulen`;

      await loadModule().login(request);

      const query = authorizationRequest().searchParams;
      expect(query.get('tenant')).toBe('schulen');
      expect(query.get('code_challenge_method')).toBe('S256');
    });
  });

  describe('the answer it accepts', () => {
    it('exchanges the code and answers with the tokens', async () => {
      const session = await loadModule().login(request);

      expect(session.accessToken).toBe('an-access-token');
      expect(session.refreshToken).toBe('a-refresh-token');
      expect(session.expiresAt).toBeGreaterThan(Date.now());
    });

    it('refuses an answer carrying somebody else`s state, without exchanging anything', async () => {
      redirectedTo = () => `${IDENTITY_REDIRECT}?code=an-auth-code&state=not-the-one-we-sent`;

      await expect(loadModule().login(request)).rejects.toThrow('OAUTH_STATE_MISMATCH');
      expect(requests.some((sent) => sent.url === TOKEN_ENDPOINT)).toBe(false);
    });

    it('reports the provider`s own refusal, with the reason it gave', async () => {
      redirectedTo = () => `${IDENTITY_REDIRECT}?error=access_denied&error_description=Nope`;

      await expect(loadModule().login(request)).rejects.toThrow(/OAUTH_REFUSED.*access_denied.*Nope/);
    });

    it('reads an answer given in the fragment as well as one in the query', async () => {
      redirectedTo = (authorizationUrl) => {
        const state = new URL(authorizationUrl).searchParams.get('state');
        return `${IDENTITY_REDIRECT}#code=an-auth-code&state=${state}`;
      };

      expect((await loadModule().login(request)).accessToken).toBe('an-access-token');
    });

    it('refuses an answer with neither a code nor an error', async () => {
      redirectedTo = (authorizationUrl) =>
        `${IDENTITY_REDIRECT}?state=${new URL(authorizationUrl).searchParams.get('state')}`;

      await expect(loadModule().login(request)).rejects.toThrow('OAUTH_NO_CODE');
    });

    it('reads a cancelled `identity` flow as a cancellation', async () => {
      redirectedTo = () => '';

      await expect(loadModule().login(request)).rejects.toThrow('OAUTH_CANCELLED');
    });
  });

  describe('the metadata it reads the endpoints from', () => {
    it('asks the repository rather than assembling the endpoints itself', async () => {
      await loadModule().login(request);

      expect(requests[0]?.url).toBe(METADATA_URL);
    });

    it('appends the well-known path exactly once to a repository given with a slash', async () => {
      await loadModule().login({ ...request, repositoryUrl: `${REPOSITORY}/` });

      expect(requests[0]?.url).toBe(METADATA_URL);
    });

    it('runs the flow off that document, endpoints and all', async () => {
      const flow = await loadModule().login(request);

      expect(flow.accessToken).toBe('an-access-token');
      // The endpoints are the provider's own and sit under a different host than the repository, so
      // nothing here could have been guessed from the base the document was fetched from.
      expect(authorizationRequest().origin + authorizationRequest().pathname).toBe(AUTHORIZATION_ENDPOINT);
    });

    it('asks only once, however many flows run against the same repository', async () => {
      const module = loadModule();
      await module.login(request);
      await module.login(request);

      expect(requests.filter((sent) => sent.url === METADATA_URL)).toHaveLength(1);
    });

    it('caches per document address, so another repository is not answered from the first one', async () => {
      const module = loadModule();
      await module.login(request);
      await module.login({ ...request, repositoryUrl: 'https://other.example/edu-sharing' }).catch(() => undefined);

      expect(requests.filter((sent) => sent.url.includes('/.well-known/'))).toHaveLength(2);
    });

    it('still needs somewhere to look: no repository is refused as such', async () => {
      await expect(loadModule().login({ ...request, repositoryUrl: '' })).rejects.toThrow('OAUTH_NO_REPOSITORY');
    });

    it('refuses a document without the endpoints the flow needs', async () => {
      discovery = { authorization_endpoint: AUTHORIZATION_ENDPOINT };

      await expect(loadModule().login(request)).rejects.toThrow('OAUTH_DISCOVERY_INCOMPLETE');
    });

    it('refuses a repository whose address serves a web page rather than metadata', async () => {
      // What a repository with no authorization server actually does: 200, and its own HTML.
      // Reported as the wrong kind of answer, not as a document that merely lacked endpoints.
      fakeFetch.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        statusText: '200',
        headers: { get: () => 'text/html' },
        text: async () => '<!DOCTYPE html><html><body>Not Found</body></html>',
      }));

      await expect(loadModule().login(request)).rejects.toThrow(/OAUTH_DISCOVERY_FAILED.*text\/html/);
    });

    it('refuses a repository that answers nothing there', async () => {
      // The ordinary repository, and the answer the panel reads as "no SSO login here".
      await expect(
        loadModule().login({ ...request, repositoryUrl: 'https://plain.example/edu-sharing' }),
      ).rejects.toThrow('OAUTH_DISCOVERY_FAILED');
    });

    it('refuses to start without a repository or without a client', async () => {
      await expect(loadModule().login({ clientId: CLIENT_ID })).rejects.toThrow('OAUTH_NO_REPOSITORY');
      await expect(loadModule().login({ repositoryUrl: REPOSITORY })).rejects.toThrow('OAUTH_NO_CLIENT_ID');
    });

    it('asks for `profile` alone where the caller names no scopes', async () => {
      // The token is traded for a repository session rather than read, so nothing else is of use —
      // and every extra scope is one the server can refuse on a page the panel never sees.
      await loadModule().login(request);

      expect(authorizationRequest().searchParams.get('scope')).toBe('profile');
    });
  });

  /** Drive the navigation the watched-tab path is waiting for, as `tabs.onUpdated` would report it. */
  function navigate(tabId: number, url: string): void {
    for (const listener of [...updateListeners]) listener(tabId, { url }, { url });
  }

  describe('asking the repository about its server before a flow is run', () => {
    it('names where it asked and what the server calls itself', async () => {
      const answer = await loadModule().metadata(request);

      expect(answer.discoveryUrl).toBe(METADATA_URL);
      // The document's own `issuer`, which is the provider rather than the repository it is
      // published under — the two are different things and the panel shows both.
      expect(answer.issuer).toBe('https://sso.example/realms/edu');
    });

    it('falls back to the repository where the document names no issuer', async () => {
      delete discovery['issuer'];

      expect((await loadModule().metadata(request)).issuer).toBe(REPOSITORY);
    });

    it('names a requested scope the server does not define', async () => {
      // The shape a Doorkeeper-based server has: metadata, but no `offline_access` among its scopes.
      // It refuses such a request on an error page of its own instead of redirecting, so the flow
      // never learns why.
      discovery['scopes_supported'] = ['openid', 'profile', 'email', 'api'];

      const answer = await loadModule().metadata({ ...request, scopes: 'profile offline_access' });

      expect(answer.unsupportedScopes).toEqual(['offline_access']);
    });

    it('names nothing where every requested scope is defined', async () => {
      discovery['scopes_supported'] = ['openid', 'profile', 'email'];

      const answer = await loadModule().metadata({ ...request, scopes: 'profile' });

      expect(answer.unsupportedScopes).toEqual([]);
      expect(answer.scopesSupported).toEqual(['openid', 'profile', 'email']);
    });

    it('claims nothing about scopes where the server lists none', async () => {
      // `scopes_supported` is optional. Absent means the server does not say, which is not a licence
      // to call every scope wrong — the caller distinguishes the two by `scopesSupported`.
      const answer = await loadModule().metadata({ ...request, scopes: 'profile made_up' });

      expect(answer.scopesSupported).toBeNull();
      expect(answer.unsupportedScopes).toEqual([]);
    });

    it('reports what logging out will be able to do, so the panel can say it', async () => {
      discovery['end_session_endpoint'] = END_SESSION_ENDPOINT;
      expect(await loadModule().metadata(request)).toMatchObject({ revocable: true, sessionEndable: true });

      delete discovery['revocation_endpoint'];
      delete discovery['end_session_endpoint'];
      expect(await loadModule().metadata(request)).toMatchObject({ revocable: false, sessionEndable: false });
    });

    it('fails the way a login would where the repository publishes nothing', async () => {
      await expect(
        loadModule().metadata({ ...request, repositoryUrl: 'https://plain.example/edu-sharing' }),
      ).rejects.toThrow('OAUTH_DISCOVERY_FAILED');
    });
  });

  describe('the redirect address', () => {
    it('is the browser`s own where there is an `identity` API', () => {
      const module = loadModule();

      expect(module.hasIdentityApi()).toBe(true);
      expect(module.redirectUri({})).toBe(IDENTITY_REDIRECT);
    });

    it('falls back to a path on the repository where there is none — Safari', () => {
      withoutIdentityApi = true;
      const module = loadModule();

      expect(module.hasIdentityApi()).toBe(false);
      expect(module.redirectUri({ repositoryUrl: `${REPOSITORY}/` })).toBe(
        `${REPOSITORY}/oauth/extension-callback`,
      );
    });

    it('has none to offer without an `identity` API and without a repository', () => {
      withoutIdentityApi = true;

      expect(() => loadModule().redirectUri({})).toThrow('OAUTH_NO_REDIRECT_URI');
    });

    it('takes the watched-tab path for any address but the one the browser handed out', () => {
      const module = loadModule();
      // Chrome's launchWebAuthFlow only ever completes on the address it handed out, so anything
      // else has to be watched for instead — otherwise the flow hangs until the window is closed.
      expect(module.hasIdentityApi()).toBe(true);
      expect(module.usesIdentityApi(`${REPOSITORY}/oauth/extension-callback`)).toBe(false);
      expect(module.usesIdentityApi(IDENTITY_REDIRECT)).toBe(true);
    });

    it('hands `launchWebAuthFlow` nothing outside the schema Chrome accepts', async () => {
      // Chrome validates WebAuthFlowDetails and rejects any unknown property outright — a
      // `redirect_uri` among them is an "Unexpected property" error, not an ignored hint. Both
      // browsers read the address out of the authorization URL, so nothing else has to be passed.
      const accepted = ['url', 'interactive', 'abortOnLoadForNonInteractive', 'timeoutMsForNonInteractive'];
      const launched: Record<string, unknown>[] = [];
      launchedOptions = launched;

      await loadModule().login(request);

      expect(Object.keys(launched[0] ?? {})).toEqual(['url', 'interactive']);
      expect(Object.keys(launched[0] ?? {}).filter((key) => !accepted.includes(key))).toEqual([]);
      // The address is in the URL, which is where both browsers take it from.
      expect(new URL(String(launched[0]?.['url'])).searchParams.get('redirect_uri')).toBe(IDENTITY_REDIRECT);
    });

    it('is what the authorization request and the token exchange both name', async () => {
      await loadModule().login(request);

      expect(authorizationRequest().searchParams.get('redirect_uri')).toBe(IDENTITY_REDIRECT);
      const exchange = requests.find((sent) => sent.body?.get('grant_type') === 'authorization_code');
      expect(exchange?.body?.get('redirect_uri')).toBe(IDENTITY_REDIRECT);
    });
  });

  describe('the watched tab that stands in for the missing `identity` API', () => {
    beforeEach(() => {
      withoutIdentityApi = true;
    });

    it('opens the provider in a tab and resolves on the redirect, then closes it', async () => {
      const module = loadModule();
      const flow = module.login(request);
      await vi.waitUntil(() => createdTabs.length > 0);

      const state = new URL(createdTabs[0].url).searchParams.get('state');
      navigate(
        createdTabs[0].id,
        `${REPOSITORY}/oauth/extension-callback?code=an-auth-code&state=${state}`,
      );

      expect((await flow).accessToken).toBe('an-access-token');
      // Closed rather than left behind: the page it was heading for is never meant to load.
      expect(removedTabs).toContain(createdTabs[0].id);
    });

    it('ignores navigations of the tab to anything but the redirect address', async () => {
      const module = loadModule();
      const flow = module.login(request);
      await vi.waitUntil(() => createdTabs.length > 0);

      // The provider's own pages: a login form, a consent screen, a federated hop.
      navigate(createdTabs[0].id, 'https://sso.example/realms/edu/login-actions/authenticate');
      expect(removedTabs).toHaveLength(0);

      const state = new URL(createdTabs[0].url).searchParams.get('state');
      navigate(
        createdTabs[0].id,
        `${REPOSITORY}/oauth/extension-callback?code=an-auth-code&state=${state}`,
      );
      await flow;
    });

    it('ignores another tab navigating to the same address', async () => {
      const module = loadModule();
      const flow = module.login(request);
      await vi.waitUntil(() => createdTabs.length > 0);

      navigate(createdTabs[0].id + 99, `${REPOSITORY}/oauth/extension-callback?code=foreign`);
      expect(removedTabs).toHaveLength(0);

      const state = new URL(createdTabs[0].url).searchParams.get('state');
      navigate(
        createdTabs[0].id,
        `${REPOSITORY}/oauth/extension-callback?code=an-auth-code&state=${state}`,
      );
      await flow;
    });

    it('reads the user closing the tab as a cancellation', async () => {
      const module = loadModule();
      const flow = module.login(request);
      await vi.waitUntil(() => createdTabs.length > 0);

      for (const listener of [...removeListeners]) listener(createdTabs[0].id);

      await expect(flow).rejects.toThrow('OAUTH_CANCELLED');
      // Nothing to close: the tab is already gone, and asking again would be an error of its own.
      expect(removedTabs).toHaveLength(0);
    });
  });

  describe('the stored session it renews from', () => {
    it('renews from the refresh token the login kept', async () => {
      const module = loadModule();
      await module.login(request);

      expect((await module.refresh(request))?.accessToken).toBe('a-renewed-token');
    });

    it('renews with no answer where nobody is signed in', async () => {
      expect(await loadModule().refresh(request)).toBeNull();
    });

    it('takes over a rotated refresh token, so the next renewal has one', async () => {
      const module = loadModule();
      await module.login(request);
      await module.refresh(request);

      expect((stored.get(module.TOKEN_STORAGE_KEY) as { refreshToken: string }).refreshToken).toBe(
        'a-rotated-refresh-token',
      );
    });

    it('keeps the token it has where the provider rotates none', async () => {
      const module = loadModule();
      await module.login(request);
      fakeFetch.mockImplementationOnce(async () => jsonResponse({ access_token: 'a-renewed-token', expires_in: 300 }));

      await module.refresh(request);

      expect((stored.get(module.TOKEN_STORAGE_KEY) as { refreshToken: string }).refreshToken).toBe('a-refresh-token');
    });

    it('discards a stored session obtained against another repository', async () => {
      const module = loadModule();
      await module.login(request);

      expect(await module.refresh({ repositoryUrl: 'https://other.example/edu-sharing', clientId: CLIENT_ID })).toBeNull();
      expect(stored.has(module.TOKEN_STORAGE_KEY)).toBe(false);
    });

    it('clears a refresh token the provider rejects — it will not start working again', async () => {
      const module = loadModule();
      await module.login(request);
      fakeFetch.mockImplementationOnce(async () => jsonResponse({ error: 'invalid_grant' }, 400));

      await expect(module.refresh(request)).rejects.toThrow(/OAUTH_TOKEN_FAILED.*invalid_grant/);
      expect(stored.has(module.TOKEN_STORAGE_KEY)).toBe(false);
    });

    it('reuses a stored access token that is still valid, without asking the provider', async () => {
      const module = loadModule();
      await module.login(request);
      const before = requests.length;

      expect((await module.silentSession(request))?.accessToken).toBe('an-access-token');
      expect(requests).toHaveLength(before);
    });

    it('does not hand out a still-valid token from a repository the panel has left', async () => {
      const module = loadModule();
      await module.login(request);

      // The fast path skips the refresh, so it has to make the same ownership check the refresh does.
      expect(await module.silentSession({ repositoryUrl: 'https://other.example/edu-sharing', clientId: CLIENT_ID })).toBeNull();
      expect(stored.has(module.TOKEN_STORAGE_KEY)).toBe(false);
    });

    it('renews a stored access token that has lapsed', async () => {
      const module = loadModule();
      await module.login(request);
      const session = stored.get(module.TOKEN_STORAGE_KEY) as { expiresAt: number };
      stored.set(module.TOKEN_STORAGE_KEY, { ...session, expiresAt: Date.now() - 1 });

      expect((await module.silentSession(request))?.accessToken).toBe('a-renewed-token');
    });
  });

  describe('logging out', () => {
    it('drops the stored session and has the provider revoke the refresh token', async () => {
      const module = loadModule();
      await module.login(request);

      expect(await module.logout(request)).toEqual({ revoked: true, sessionEnded: false });

      expect(stored.has(module.TOKEN_STORAGE_KEY)).toBe(false);
      const revoked = requests.find((sent) => sent.url === REVOCATION_ENDPOINT);
      expect(revoked?.body?.get('token')).toBe('a-refresh-token');
      expect(revoked?.body?.get('token_type_hint')).toBe('refresh_token');
    });

    it('counts a revocation answered with no content as done', async () => {
      const module = loadModule();
      await module.login(request);
      // What RFC 7009 §2.2 prescribes and Keycloak sends: 200 and an empty body.
      fakeFetch.mockImplementationOnce(async () => ({ ok: true, status: 200, statusText: '200', text: async () => '' }));

      expect(await module.logout(request)).toMatchObject({ revoked: true });
    });

    it('drops it even where the provider cannot be told', async () => {
      const module = loadModule();
      await module.login(request);
      fakeFetch.mockImplementationOnce(async () => jsonResponse({ error: 'server_error' }, 500));

      expect(await module.logout(request)).toMatchObject({ revoked: false });
      // Whether the provider could be told is not allowed to decide whether a credential is still held.
      expect(stored.has(module.TOKEN_STORAGE_KEY)).toBe(false);
    });

    it('drops it where the server has no revocation endpoint at all', async () => {
      delete discovery['revocation_endpoint'];
      const module = loadModule();
      await module.login(request);

      expect(await module.logout(request)).toEqual({ revoked: false, sessionEnded: false });
      expect(stored.has(module.TOKEN_STORAGE_KEY)).toBe(false);
    });

    it('has nothing to do where nobody is signed in', async () => {
      expect(await loadModule().logout(request)).toEqual({ revoked: false, sessionEnded: false });
    });

    describe('ending the provider`s own session, where the metadata names a way to', () => {
      beforeEach(() => {
        discovery['end_session_endpoint'] = END_SESSION_ENDPOINT;
      });

      it('drives that address through the browser, so the provider`s cookie goes with the token', async () => {
        // Without this the provider answers the next authorization request straight from its cookie:
        // a logout after which the same user is silently signed back in.
        const launched: Record<string, unknown>[] = [];
        launchedOptions = launched;
        const module = loadModule();
        await module.login(request);

        expect(await module.logout(request)).toEqual({ revoked: true, sessionEnded: true });

        const logoutCall = launched.find((options) => String(options['url']).startsWith(END_SESSION_ENDPOINT));
        expect(logoutCall?.['interactive']).toBe(false);
        expect(new URL(String(logoutCall?.['url'])).searchParams.get('client_id')).toBe(CLIENT_ID);
      });

      it('names the session to end by id token, where the scopes yielded one', async () => {
        const launched: Record<string, unknown>[] = [];
        launchedOptions = launched;
        const module = loadModule();
        fakeFetch.mockImplementationOnce(async () => jsonResponse(discovery));
        fakeFetch.mockImplementationOnce(async () =>
          jsonResponse({ access_token: 'an-access-token', id_token: 'an-id-token', expires_in: 300 }),
        );
        await module.login(request);

        await module.logout(request);

        const logoutCall = launched.find((options) => String(options['url']).startsWith(END_SESSION_ENDPOINT));
        expect(new URL(String(logoutCall?.['url'])).searchParams.get('id_token_hint')).toBe('an-id-token');
      });

      it('sends no post-logout address, which only a registered one could be', async () => {
        // An unregistered `post_logout_redirect_uri` turns the logout into the provider`s error page,
        // and the address the browser hands this extension is not registered anywhere.
        const launched: Record<string, unknown>[] = [];
        launchedOptions = launched;
        const module = loadModule();
        await module.login(request);

        await module.logout(request);

        const logoutCall = launched.find((options) => String(options['url']).startsWith(END_SESSION_ENDPOINT));
        expect(new URL(String(logoutCall?.['url'])).searchParams.get('post_logout_redirect_uri')).toBeNull();
      });

      it('counts it as done although nothing redirects back — there is nothing to wait for', async () => {
        const module = loadModule();
        await module.login(request);
        // What Chrome answers a non-interactive flow that lands on a page instead of a redirect. The
        // logout has been performed by then, and neither browser reports more than this.
        redirectedTo = () => {
          throw new Error('user interaction required');
        };

        expect(await module.logout(request)).toMatchObject({ sessionEnded: true });
      });

      it('opens a background tab where there is no `identity` API — Safari', async () => {
        withoutIdentityApi = true;
        const module = loadModule();
        stored.set(module.TOKEN_STORAGE_KEY, {
          accessToken: 'an-access-token',
          refreshToken: 'a-refresh-token',
          repository: REPOSITORY,
          clientId: CLIENT_ID,
        });

        expect(await module.logout(request)).toMatchObject({ sessionEnded: true });

        const opened = createdTabs.find((tab) => tab.url.startsWith(END_SESSION_ENDPOINT));
        expect(opened).toBeDefined();
      });

      it('ends the session for a token the scopes left without a refresh token', async () => {
        // The default scopes ask for none, so this is the ordinary case: there is nothing to revoke
        // and the provider's session is all that is left to drop.
        const module = loadModule();
        stored.set(module.TOKEN_STORAGE_KEY, {
          accessToken: 'an-access-token',
          repository: REPOSITORY,
          clientId: CLIENT_ID,
        });

        expect(await module.logout(request)).toEqual({ revoked: false, sessionEnded: true });
        expect(stored.has(module.TOKEN_STORAGE_KEY)).toBe(false);
      });
    });
  });
});
