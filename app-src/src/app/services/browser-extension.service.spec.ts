import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetExtensionApi, useExtensionApi } from '../../testing/extension-globals.setup';
import {
  AnalyzeResponse,
  BrowserExtensionService,
  PageData,
  PageReadResponse,
  PageSource,
  WORKER_UNREACHABLE,
} from './browser-extension.service';

/**
 * The one service whose subject *is* the extension API, so it is the one spec that may not have the
 * API faked away. `extension-globals.setup.ts` puts a proxy in `globalThis.browser` that refuses every
 * member; here a stub that answers stands in its place, and the service is loaded against it.
 *
 * `useExtensionApi()` is the seam that allows it: the proxy is what the service holds — the polyfill
 * reads the global once, at import, and re-exports it unchanged — so what a test can still decide is
 * what the proxy answers out of. Every test installs a browser of its own and takes it away again.
 */

/** What the worker is asked, as the service words it. */
type Message = Record<string, unknown>;

/** A listener as `runtime.onMessage` takes them. */
type Listener = (message: unknown) => unknown;

/**
 * A browser around the panel: the three APIs the service uses, plus the means to act as the other side
 * — answer a message, and broadcast one of the worker's announcements.
 */
function fakeExtensionApi() {
  const listeners: Listener[] = [];
  const stored = new Map<string, unknown>();

  const sendMessage = vi.fn((_message: Message): Promise<unknown> => Promise.resolve(null));

  const api = {
    runtime: {
      id: 'edu-sharing-unit-test',
      sendMessage,
      onMessage: {
        addListener: vi.fn((listener: Listener) => {
          listeners.push(listener);
        }),
      },
    },
    storage: {
      local: {
        get: vi.fn((query: Record<string, unknown>): Promise<Record<string, unknown>> => {
          const items: Record<string, unknown> = {};
          for (const [key, fallback] of Object.entries(query)) {
            items[key] = stored.has(key) ? stored.get(key) : fallback;
          }
          return Promise.resolve(items);
        }),
        set: vi.fn((items: Record<string, unknown>): Promise<void> => {
          for (const [key, value] of Object.entries(items)) stored.set(key, value);
          return Promise.resolve();
        }),
      },
    },
  };

  /** The worker broadcasts a message to every panel — what the constructor's listener sees. */
  function broadcast(message: unknown): void {
    for (const listener of listeners) listener(message);
  }

  /** How many panels are listening: 0 outside an extension, 1 in one. */
  const listening = (): number => listeners.length;

  return { api, sendMessage, stored, broadcast, listening };
}

type ExtensionApi = ReturnType<typeof fakeExtensionApi>;

/** The window the panel sits in, as jsdom defines it before a test replaces it. */
const realParent = Object.getOwnPropertyDescriptor(globalThis, 'parent');

describe('BrowserExtensionService', () => {
  /** The browser the panel is loaded into. */
  let browser: ExtensionApi;

  /** The service under test, built by {@link boot}. */
  let service: BrowserExtensionService;

  beforeEach(() => {
    vi.useFakeTimers();
    browser = fakeExtensionApi();
    useExtensionApi(browser.api as unknown as Record<string, unknown>);
  });

  afterEach(() => {
    resetExtensionApi();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // Put back after the stubs, since the cross-origin case replaces `parent` with a getter of its
    // own rather than through `stubGlobal`, and nothing else would restore that.
    if (realParent) Object.defineProperty(globalThis, 'parent', realParent);
  });

  /**
   * Construct the panel's wrapper against the stub browser. `available: false` is the panel run
   * outside an extension — a plain dev server, where `runtime.id` is what is missing — which the
   * service reads at construction, so dropping the id beforehand is the whole difference.
   */
  function boot({ available = true }: { available?: boolean } = {}): void {
    if (!available) delete (browser.api.runtime as { id?: string }).id;
    service = new BrowserExtensionService();
  }

  /** Let the microtasks already queued run — the constructor's `tabs.self` answer arrives in one. */
  async function flush(): Promise<void> {
    for (let round = 0; round < 8; round++) await Promise.resolve();
  }

  /**
   * Drive a call through the send retries, whose delays are the only timers the service sets. The
   * outcome is taken hold of before the clock moves: a call that rejects would otherwise do so while
   * nothing is waiting on it yet, which the runner reports as an unhandled rejection.
   */
  async function through<T>(call: Promise<T>): Promise<T> {
    const outcome = call.then(
      (value) => () => value,
      (cause: unknown) => () => {
        throw cause;
      },
    );
    await vi.advanceTimersByTimeAsync(5000);
    return (await outcome)();
  }

  /** A rejection whose wording means the message was never delivered. */
  const undelivered = (): Error =>
    new Error('Could not establish connection. Receiving end does not exist.');

  describe('outside an extension', () => {
    beforeEach(() => boot({ available: false }));

    it('says so', () => {
      expect(service.available).toBe(false);
    });

    it('does not listen for the worker announcing a page', () => {
      expect(browser.listening()).toBe(0);
    });

    it('never sends anything', async () => {
      await service.analyzeActiveTab('de');

      expect(browser.sendMessage).not.toHaveBeenCalled();
    });

    it('answers a stored value with the fallback', async () => {
      await expect(service.storageGet('flow', { step: 'menu' })).resolves.toEqual({ step: 'menu' });
      expect(browser.api.storage.local.get).not.toHaveBeenCalled();
    });

    it('drops what it is asked to store', async () => {
      await service.storageSet('flow', { step: 'menu' });

      expect(browser.api.storage.local.set).not.toHaveBeenCalled();
      expect(browser.stored.size).toBe(0);
    });

    it('reports the worker as unreachable rather than as a refusal', async () => {
      await expect(service.analyzeActiveTab('de')).resolves.toEqual({
        success: false,
        error: WORKER_UNREACHABLE,
      });
      await expect(service.saveNode({})).resolves.toEqual({
        success: false,
        error: WORKER_UNREACHABLE,
      });
    });

    it('throws where a caller has already saved state for what it asked', async () => {
      await expect(service.navigateTab('https://example.org')).rejects.toThrow(WORKER_UNREACHABLE);
      await expect(service.openWindow('https://example.org')).rejects.toThrow(WORKER_UNREACHABLE);
      await expect(service.openTab('https://example.org')).rejects.toThrow(WORKER_UNREACHABLE);
    });

    it('answers the questions whose answer may be nothing with nothing', async () => {
      await expect(service.getOwnTabId()).resolves.toBeNull();
      await expect(service.getActiveTab()).resolves.toBeNull();
      await expect(service.readPage()).resolves.toBeNull();
      await expect(service.extractPageData()).resolves.toBeNull();
      await expect(service.oauthRedirectUri({ repositoryUrl: 'r', clientId: 'c', scopes: 's' })).resolves.toBeNull();
    });

    it('rejects a discovery, which has no answer that means nothing', async () => {
      await expect(
        service.oauthDiscover({ repositoryUrl: 'r', clientId: 'c', scopes: 's' }),
      ).rejects.toThrow(WORKER_UNREACHABLE);
    });
  });

  describe('the page the worker announces', () => {
    it('is nothing until one arrives', async () => {
      boot();

      expect(service.announcedPage()).toBeNull();
      expect(browser.listening()).toBe(1);
    });

    it('is the address and the title together', async () => {
      boot();
      await flush();

      browser.broadcast({ action: 'tab.url', url: 'https://example.org/optik', title: 'Optik' });

      expect(service.announcedPage()).toEqual({ url: 'https://example.org/optik', title: 'Optik' });
    });

    it('carries no title for a tab that has none yet', async () => {
      boot();
      await flush();

      browser.broadcast({ action: 'tab.url', url: 'https://example.org/optik' });

      expect(service.announcedPage()).toEqual({ url: 'https://example.org/optik', title: null });
    });

    it('follows a page that routes in place', async () => {
      boot();
      await flush();

      browser.broadcast({ action: 'tab.url', url: 'https://example.org/a' });
      browser.broadcast({ action: 'tab.url', url: 'https://example.org/b' });

      expect(service.announcedPage()?.url).toBe('https://example.org/b');
    });

    it('ignores a message that announces something else', async () => {
      boot();
      await flush();

      browser.broadcast({ action: 'flow.resume', url: 'https://example.org/optik' });
      browser.broadcast(null);
      browser.broadcast({ action: 'tab.url' });
      browser.broadcast({ action: 'tab.url', url: '' });

      expect(service.announcedPage()).toBeNull();
    });

    it('ignores another tab once it knows which one it sits in', async () => {
      browser.sendMessage.mockResolvedValue({ tabId: 7 });
      boot();
      await flush();

      browser.broadcast({ action: 'tab.url', tabId: 9, url: 'https://example.org/fremd' });

      expect(service.announcedPage()).toBeNull();

      browser.broadcast({ action: 'tab.url', tabId: 7, url: 'https://example.org/eigen' });

      expect(service.announcedPage()?.url).toBe('https://example.org/eigen');
    });

    it('ignores an announcement that names no tab at all once it knows its own', async () => {
      browser.sendMessage.mockResolvedValue({ tabId: 7 });
      boot();
      await flush();

      browser.broadcast({ action: 'tab.url', url: 'https://example.org/fremd' });

      expect(service.announcedPage()).toBeNull();
    });

    it('takes every announcement while it does not know its own tab', async () => {
      browser.sendMessage.mockResolvedValue({ tabId: null });
      boot();
      await flush();

      browser.broadcast({ action: 'tab.url', tabId: 9, url: 'https://example.org/irgendwo' });

      expect(service.announcedPage()?.url).toBe('https://example.org/irgendwo');
    });

    it('asks the worker which tab it sits in, once', async () => {
      boot();
      await flush();

      expect(browser.sendMessage).toHaveBeenCalledTimes(1);
      expect(browser.sendMessage).toHaveBeenCalledWith({ action: 'tabs.self' });
    });
  });

  describe('sending to the worker', () => {
    beforeEach(() => {
      boot();
      // The constructor asks which tab the panel sits in; what the counts below are about is the
      // send the test itself makes.
      browser.sendMessage.mockClear();
    });

    it('names the agent the configured repository points at', async () => {
      await service.analyzeActiveTab('de', 'https://agent.example/api');

      expect(browser.sendMessage).toHaveBeenLastCalledWith({
        action: 'analyze.run',
        language: 'de',
        apiUrl: 'https://agent.example/api',
      });
    });

    it('leaves the agent unnamed where the panel knows of none', async () => {
      await service.analyzeActiveTab('de');

      expect(browser.sendMessage).toHaveBeenLastCalledWith({
        action: 'analyze.run',
        language: 'de',
        apiUrl: undefined,
      });
    });

    it('passes the worker answer through as it stands', async () => {
      const answer: AnalyzeResponse = { success: true, result: { title: 'Optik' } };
      browser.sendMessage.mockResolvedValue(answer);

      await expect(service.analyzeActiveTab('de')).resolves.toBe(answer);
    });

    it('reads an empty answer as nobody having answered', async () => {
      browser.sendMessage.mockResolvedValue(undefined);

      await expect(service.analyzeActiveTab('de')).resolves.toEqual({
        success: false,
        error: 'NO_RESPONSE',
      });
    });

    it('repeats a send that was never delivered', async () => {
      browser.sendMessage.mockRejectedValueOnce(undelivered()).mockResolvedValue({ success: true });

      await expect(through(service.analyzeActiveTab('de'))).resolves.toEqual({ success: true });
      expect(browser.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('waits longer before each further attempt', async () => {
      browser.sendMessage.mockRejectedValue(undelivered());
      const call = service.analyzeActiveTab('de');
      await flush();

      expect(browser.sendMessage).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(149);
      expect(browser.sendMessage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(browser.sendMessage).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(299);
      expect(browser.sendMessage).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(browser.sendMessage).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(450);
      expect(browser.sendMessage).toHaveBeenCalledTimes(4);

      await through(call);
    });

    it('gives up after four attempts, and says the worker is unreachable', async () => {
      browser.sendMessage.mockRejectedValue(undelivered());

      await expect(through(service.analyzeActiveTab('de'))).resolves.toEqual({
        success: false,
        error: WORKER_UNREACHABLE,
      });
      expect(browser.sendMessage).toHaveBeenCalledTimes(4);
    });

    it('repeats a rejection that names only the connection', async () => {
      browser.sendMessage
        .mockRejectedValueOnce(new Error('Could not establish connection.'))
        .mockResolvedValue({ success: true });

      await expect(through(service.analyzeActiveTab('de'))).resolves.toEqual({ success: true });
    });

    it('repeats a rejection that is not an error object at all', async () => {
      browser.sendMessage
        .mockRejectedValueOnce('Receiving end does not exist.')
        .mockResolvedValue({ success: true });

      await expect(through(service.analyzeActiveTab('de'))).resolves.toEqual({ success: true });
    });

    it('does not repeat a listener that died half way, which may have written', async () => {
      const died = new Error('The message port closed before a response was received.');
      browser.sendMessage.mockRejectedValue(died);

      await expect(through(service.saveNode({ title: 'Optik' }))).rejects.toBe(died);
      expect(browser.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('passes the worker own refusal on to the caller', async () => {
      const refused = new Error('agent unreachable');
      browser.sendMessage.mockRejectedValue(refused);

      await expect(through(service.analyzeActiveTab('de'))).rejects.toBe(refused);
      expect(browser.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('running the metadata agent on a named page', () => {
    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('names the page, since no tab is involved in reading it', async () => {
      await service.analyzeUrl('https://example.org/optik', 'de', 'Optik', 'https://agent.example');

      expect(browser.sendMessage).toHaveBeenCalledWith({
        action: 'analyze.url',
        url: 'https://example.org/optik',
        title: 'Optik',
        language: 'de',
        apiUrl: 'https://agent.example',
      });
    });

    it('passes the answer through, and reads an empty one as nobody having answered', async () => {
      const answer: AnalyzeResponse = { success: true, result: { title: 'Optik' } };
      browser.sendMessage.mockResolvedValueOnce(answer);
      await expect(service.analyzeUrl('https://example.org', 'de')).resolves.toBe(answer);

      browser.sendMessage.mockResolvedValueOnce(null);
      await expect(service.analyzeUrl('https://example.org', 'de')).resolves.toEqual({
        success: false,
        error: 'NO_RESPONSE',
      });
    });

    it('does not repeat an undelivered send, unlike the messages that go through ask', async () => {
      const cause = undelivered();
      browser.sendMessage.mockRejectedValue(cause);

      await expect(through(service.analyzeUrl('https://example.org', 'de'))).rejects.toBe(cause);
      expect(browser.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe('writing the node through the worker', () => {
    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('hands the body and the agent it is meant for', async () => {
      await service.saveNode({ title: 'Optik' }, 'https://agent.example');

      expect(browser.sendMessage).toHaveBeenCalledWith({
        action: 'metadata.saveNode',
        body: { title: 'Optik' },
        apiUrl: 'https://agent.example',
      });
    });

    it('passes the endpoint verdict through untouched, refusal included', async () => {
      const refused = { success: true, result: { success: false, error: 'node is not editable' } };
      browser.sendMessage.mockResolvedValue(refused);

      await expect(service.saveNode({})).resolves.toBe(refused);
    });

    it('reports a worker that never answered, and one that was never reached', async () => {
      browser.sendMessage.mockResolvedValueOnce(null);
      await expect(service.saveNode({})).resolves.toEqual({ success: false, error: 'NO_RESPONSE' });

      browser.sendMessage.mockRejectedValue(undelivered());
      await expect(through(service.saveNode({}))).resolves.toEqual({
        success: false,
        error: WORKER_UNREACHABLE,
      });
    });
  });

  describe('dropping the repository cookies', () => {
    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('names the repository whose cookies are to go', async () => {
      browser.sendMessage.mockResolvedValue({ success: true, removed: ['JSESSIONID'] });

      await expect(service.dropSessionCookies('https://repo.example/edu-sharing')).resolves.toEqual({
        success: true,
        removed: ['JSESSIONID'],
      });
      expect(browser.sendMessage).toHaveBeenCalledWith({
        action: 'session.dropCookies',
        repositoryUrl: 'https://repo.example/edu-sharing',
      });
    });

    it('tells an address that had no session from a worker that was not there', async () => {
      browser.sendMessage.mockResolvedValueOnce({ success: true, removed: [] });
      await expect(service.dropSessionCookies('https://repo.example')).resolves.toEqual({
        success: true,
        removed: [],
      });

      browser.sendMessage.mockResolvedValueOnce(null);
      await expect(service.dropSessionCookies('https://repo.example')).resolves.toEqual({
        success: false,
        error: 'NO_RESPONSE',
      });

      browser.sendMessage.mockRejectedValue(undelivered());
      await expect(through(service.dropSessionCookies('https://repo.example'))).resolves.toEqual({
        success: false,
        error: WORKER_UNREACHABLE,
      });
    });
  });

  describe('the tab the panel sits in', () => {
    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('is what the worker answers, asked as tabs.self', async () => {
      browser.sendMessage.mockResolvedValue({ tabId: 7 });

      await expect(service.getOwnTabId()).resolves.toBe(7);
      expect(browser.sendMessage).toHaveBeenCalledWith({ action: 'tabs.self' });
    });

    it('is nothing where the answer names no number', async () => {
      browser.sendMessage.mockResolvedValueOnce({ tabId: null });
      await expect(service.getOwnTabId()).resolves.toBeNull();

      browser.sendMessage.mockResolvedValueOnce({ tabId: '7' });
      await expect(service.getOwnTabId()).resolves.toBeNull();

      browser.sendMessage.mockResolvedValueOnce({});
      await expect(service.getOwnTabId()).resolves.toBeNull();

      browser.sendMessage.mockResolvedValueOnce(null);
      await expect(service.getOwnTabId()).resolves.toBeNull();
    });

    it('is nothing rather than a failure where the worker cannot be asked', async () => {
      browser.sendMessage.mockRejectedValue(undelivered());
      await expect(through(service.getOwnTabId())).resolves.toBeNull();

      browser.sendMessage.mockRejectedValue(new Error('worker refused'));
      await expect(through(service.getOwnTabId())).resolves.toBeNull();
    });

    it('counts as the tab 0, which is a tab like any other', async () => {
      browser.sendMessage.mockResolvedValue({ tabId: 0 });

      await expect(service.getOwnTabId()).resolves.toBe(0);
    });
  });

  describe('the page the browser is showing', () => {
    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('is the tab the worker reports', async () => {
      const tab: PageSource = { url: 'https://example.org/optik', title: 'Optik' };
      browser.sendMessage.mockResolvedValue({ success: true, tab });

      await expect(service.getActiveTab()).resolves.toBe(tab);
      expect(browser.sendMessage).toHaveBeenCalledWith({ action: 'tabs.getActive' });
    });

    it('is nothing where the worker has no tab to report', async () => {
      browser.sendMessage.mockResolvedValueOnce({ success: true });
      await expect(service.getActiveTab()).resolves.toBeNull();

      browser.sendMessage.mockResolvedValueOnce({ success: false });
      await expect(service.getActiveTab()).resolves.toBeNull();

      browser.sendMessage.mockResolvedValueOnce(null);
      await expect(service.getActiveTab()).resolves.toBeNull();
    });

    it('is nothing where the worker refuses, rather than a rejection', async () => {
      browser.sendMessage.mockRejectedValue(new Error('no tab'));

      await expect(through(service.getActiveTab())).resolves.toBeNull();
    });
  });

  describe('reading the open page', () => {
    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('answers with what the content script found', async () => {
      const data: PageData = { url: 'https://example.org/optik', title: 'Optik', text: 'Licht' };
      browser.sendMessage.mockResolvedValue({ success: true, data });

      await expect(service.extractPageData()).resolves.toBe(data);
      expect(browser.sendMessage).toHaveBeenCalledWith({ action: 'tabs.extractPageData' });
    });

    it('reads a page that cannot be injected into as no page, not as an error', async () => {
      browser.sendMessage.mockResolvedValueOnce({ success: false, error: 'cannot inject' });
      await expect(service.extractPageData()).resolves.toBeNull();

      browser.sendMessage.mockResolvedValueOnce({ success: true });
      await expect(service.extractPageData()).resolves.toBeNull();

      browser.sendMessage.mockRejectedValue(undelivered());
      await expect(through(service.extractPageData())).resolves.toBeNull();
    });

    it('answers the record of where it was read as well, asked as page.read', async () => {
      const page: PageReadResponse = {
        success: true,
        data: { url: 'https://example.org/optik', title: 'Optik' },
        source: { url: 'https://example.org/optik', title: 'Optik', screenshot: 'data:image/png;base64,AA' },
      };
      browser.sendMessage.mockResolvedValue(page);

      await expect(service.readPage()).resolves.toBe(page);
      expect(browser.sendMessage).toHaveBeenCalledWith({ action: 'page.read' });
    });

    it('answers nothing for a page the content script could not read', async () => {
      browser.sendMessage.mockResolvedValueOnce({ success: false, error: 'cannot inject' });
      await expect(service.readPage()).resolves.toBeNull();

      browser.sendMessage.mockResolvedValueOnce(null);
      await expect(service.readPage()).resolves.toBeNull();
    });
  });

  describe('the OAuth flow the worker runs', () => {
    /** What the panel points the worker at — the repository plus its own shipped constants. */
    const request = {
      repositoryUrl: 'https://repo.example/edu-sharing',
      clientId: 'edu-sharing-panel',
      scopes: 'openid profile',
    };

    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('shows the provider pages for a login, and names the provider to go straight to', async () => {
      browser.sendMessage.mockResolvedValue({ success: true, accessToken: 'tok' });

      await expect(service.oauthLogin({ ...request, registrationId: 'shibboleth' })).resolves.toEqual({
        success: true,
        accessToken: 'tok',
      });
      expect(browser.sendMessage).toHaveBeenCalledWith({
        action: 'oauth.login',
        ...request,
        registrationId: 'shibboleth',
      });
    });

    it('shows nothing for the silent attempt, whose ordinary answer is nobody signed in', async () => {
      browser.sendMessage.mockResolvedValue({ success: true, signedIn: false });

      await expect(service.oauthSilent(request)).resolves.toEqual({ success: true, signedIn: false });
      expect(browser.sendMessage).toHaveBeenCalledWith({ action: 'oauth.silent', ...request });
    });

    it('ends the session at the worker on a logout', async () => {
      browser.sendMessage.mockResolvedValue({ success: true });

      await expect(service.oauthLogout(request)).resolves.toEqual({ success: true });
      expect(browser.sendMessage).toHaveBeenCalledWith({ action: 'oauth.logout', ...request });
    });

    it('tells a refused login from a flow that never ran', async () => {
      browser.sendMessage.mockResolvedValueOnce({ success: false, error: 'OAUTH_CANCELLED' });
      await expect(service.oauthLogin(request)).resolves.toEqual({
        success: false,
        error: 'OAUTH_CANCELLED',
      });

      browser.sendMessage.mockResolvedValueOnce(null);
      await expect(service.oauthLogin(request)).resolves.toEqual({
        success: false,
        error: 'NO_RESPONSE',
      });

      browser.sendMessage.mockRejectedValue(undelivered());
      await expect(through(service.oauthSilent(request))).resolves.toEqual({
        success: false,
        error: WORKER_UNREACHABLE,
      });
    });
  });

  describe('what the repository says about its authorization server', () => {
    const request = { repositoryUrl: 'https://repo.example/edu-sharing', clientId: 'c', scopes: 'openid' };

    /** A server that answers, as the worker assembles the answer. */
    const discovered = {
      success: true,
      discoveryUrl: 'https://repo.example/edu-sharing/.well-known/oauth-authorization-server',
      issuer: 'https://login.example',
      revocable: true,
      sessionEndable: false,
      scopesSupported: ['openid', 'profile'],
      unsupportedScopes: ['offline_access'],
    };

    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('answers what it says, and nothing of how the message went', async () => {
      browser.sendMessage.mockResolvedValue(discovered);

      await expect(service.oauthDiscover(request)).resolves.toEqual({
        discoveryUrl: discovered.discoveryUrl,
        issuer: 'https://login.example',
        revocable: true,
        sessionEndable: false,
        scopesSupported: ['openid', 'profile'],
        unsupportedScopes: ['offline_access'],
      });
      expect(browser.sendMessage).toHaveBeenCalledWith({ action: 'oauth.discover', ...request });
    });

    it('rejects with the flow own code for a repository that federates against nothing', async () => {
      browser.sendMessage.mockResolvedValue({ success: false, error: 'OAUTH_DISCOVERY_FAILED: 404' });

      await expect(service.oauthDiscover(request)).rejects.toThrow('OAUTH_DISCOVERY_FAILED: 404');
    });

    it('rejects with NO_RESPONSE where the refusal names no reason', async () => {
      browser.sendMessage.mockResolvedValueOnce({ success: false, error: '' });
      await expect(service.oauthDiscover(request)).rejects.toThrow('NO_RESPONSE');

      browser.sendMessage.mockResolvedValueOnce(null);
      await expect(service.oauthDiscover(request)).rejects.toThrow('NO_RESPONSE');
    });

    it('rejects with the unreachable worker rather than with a repository verdict', async () => {
      browser.sendMessage.mockRejectedValue(undelivered());

      await expect(through(service.oauthDiscover(request))).rejects.toThrow(WORKER_UNREACHABLE);
    });
  });

  describe('the redirect address the flow will use', () => {
    const request = { repositoryUrl: 'https://repo.example/edu-sharing', clientId: 'c', scopes: 'openid' };

    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('is the one the browser made up, where there is an identity API', async () => {
      browser.sendMessage.mockResolvedValue({
        success: true,
        redirectUri: 'https://abc.chromiumapp.org/',
        usesIdentityApi: true,
      });

      await expect(service.oauthRedirectUri(request)).resolves.toEqual({
        redirectUri: 'https://abc.chromiumapp.org/',
        usesIdentityApi: true,
      });
      expect(browser.sendMessage).toHaveBeenCalledWith({ action: 'oauth.redirectUri', ...request });
    });

    it('is a repository path that is watched for instead, where there is not', async () => {
      browser.sendMessage.mockResolvedValue({
        success: true,
        redirectUri: 'https://repo.example/edu-sharing/oauth2/callback',
        usesIdentityApi: false,
      });

      await expect(service.oauthRedirectUri(request)).resolves.toEqual({
        redirectUri: 'https://repo.example/edu-sharing/oauth2/callback',
        usesIdentityApi: false,
      });
    });

    it('reads anything but a plain yes as not the identity API', async () => {
      browser.sendMessage.mockResolvedValue({ success: true, redirectUri: 'https://repo.example/cb' });

      await expect(service.oauthRedirectUri(request)).resolves.toEqual({
        redirectUri: 'https://repo.example/cb',
        usesIdentityApi: false,
      });
    });

    it('is nothing where the worker cannot say', async () => {
      browser.sendMessage.mockResolvedValueOnce({ success: false });
      await expect(service.oauthRedirectUri(request)).resolves.toBeNull();

      browser.sendMessage.mockResolvedValueOnce({ success: true, redirectUri: '' });
      await expect(service.oauthRedirectUri(request)).resolves.toBeNull();

      browser.sendMessage.mockResolvedValueOnce(null);
      await expect(service.oauthRedirectUri(request)).resolves.toBeNull();

      browser.sendMessage.mockRejectedValue(undelivered());
      await expect(through(service.oauthRedirectUri(request))).resolves.toBeNull();
    });
  });

  describe('the extension storage', () => {
    beforeEach(() => boot());

    it('asks with the fallback as the default, which is how the API states one', async () => {
      await service.storageGet('flow', { step: 'menu' });

      expect(browser.api.storage.local.get).toHaveBeenCalledWith({ flow: { step: 'menu' } });
    });

    it('answers with what a previous session wrote', async () => {
      await service.storageSet('flow', { step: 'quality' });

      expect(browser.api.storage.local.set).toHaveBeenCalledWith({ flow: { step: 'quality' } });
      await expect(service.storageGet('flow', { step: 'menu' })).resolves.toEqual({ step: 'quality' });
    });

    it('answers with the fallback where nothing was written', async () => {
      await expect(service.storageGet('flow', { step: 'menu' })).resolves.toEqual({ step: 'menu' });
    });

    it('keeps a stored value that reads as nothing', async () => {
      await service.storageSet('seen', false);

      await expect(service.storageGet('seen', true)).resolves.toBe(false);
    });
  });

  describe('taking the browser somewhere', () => {
    beforeEach(() => {
      boot();
      browser.sendMessage.mockClear();
    });

    it('navigates the panel own tab through the worker, which outlives the load', async () => {
      await service.navigateTab('https://example.org/optik');

      expect(browser.sendMessage).toHaveBeenCalledWith({
        action: 'tabs.navigate',
        url: 'https://example.org/optik',
      });
    });

    it('opens a window of its own for a page that may ask the user something', async () => {
      await service.openWindow('https://repo.example/edu-sharing/logout');

      expect(browser.sendMessage).toHaveBeenCalledWith({
        action: 'tabs.visit',
        url: 'https://repo.example/edu-sharing/logout',
        window: true,
      });
    });

    it('opens a tab beside the panel, and decides whether the user is taken there', async () => {
      await service.openTab('https://example.org/weiter');
      expect(browser.sendMessage).toHaveBeenLastCalledWith({
        action: 'tabs.visit',
        url: 'https://example.org/weiter',
        active: true,
      });

      await service.openTab('https://example.org/still', { active: false });
      expect(browser.sendMessage).toHaveBeenLastCalledWith({
        action: 'tabs.visit',
        url: 'https://example.org/still',
        active: false,
      });
    });

    it('reports a load that will never happen, since the caller has saved its state for it', async () => {
      browser.sendMessage.mockRejectedValue(undelivered());

      await expect(through(service.navigateTab('https://example.org'))).rejects.toThrow(WORKER_UNREACHABLE);
      await expect(through(service.openWindow('https://example.org'))).rejects.toThrow(WORKER_UNREACHABLE);
      await expect(through(service.openTab('https://example.org'))).rejects.toThrow(WORKER_UNREACHABLE);
    });
  });

  describe('the page the panel is embedded in', () => {
    /** What the host page received, in the order the panel posted it. */
    let posted: ReturnType<typeof vi.fn>;

    /** The panel sits in an iframe of a page that is listening. */
    function embedded(): void {
      posted = vi.fn();
      vi.stubGlobal('parent', { postMessage: posted } as unknown as Window);
    }

    /** It does not: the panel is its own tab, so the window own parent is itself. */
    function standalone(): void {
      vi.stubGlobal('parent', globalThis);
    }

    beforeEach(() => boot());

    it('hands the chosen nodes to the host, for OnlyOffice to insert', () => {
      embedded();

      service.insertNodes([{ ref: { id: 'abc' } }]);

      expect(posted).toHaveBeenCalledWith(
        { type: 'edusharing-insert-node', nodes: [{ ref: { id: 'abc' } }] },
        '*',
      );
    });

    it('asks the host for the open document, under the id the answer will carry', () => {
      embedded();

      expect(service.requestDocumentContent('req-1')).toBe(true);
      expect(posted).toHaveBeenCalledWith(
        { type: 'edusharing-request-document-content', requestId: 'req-1' },
        '*',
      );
    });

    it('asks for the document identity alone where the content is not wanted', () => {
      embedded();

      expect(service.requestDocumentInfo('req-2')).toBe(true);
      expect(posted).toHaveBeenCalledWith(
        { type: 'edusharing-request-document-info', requestId: 'req-2' },
        '*',
      );
    });

    it('says it has booted, so a buffered event can be replayed', () => {
      embedded();

      service.signalReady();

      expect(posted).toHaveBeenCalledWith({ type: 'edusharing-sidebar-ready' }, '*');
    });

    it('has the host close the panel', () => {
      embedded();
      const closed = vi.spyOn(window, 'close').mockImplementation(() => undefined);

      service.closePanel();

      expect(posted).toHaveBeenCalledWith({ type: 'edusharing-panel-close' }, '*');
      expect(closed).not.toHaveBeenCalled();
    });

    it('answers that there is nobody to ask where the panel is its own tab', () => {
      standalone();

      expect(service.requestDocumentContent('req-1')).toBe(false);
      expect(service.requestDocumentInfo('req-2')).toBe(false);
    });

    it('closes its own tab where there is no host page to close it', () => {
      standalone();
      const closed = vi.spyOn(window, 'close').mockImplementation(() => undefined);

      service.closePanel();

      expect(closed).toHaveBeenCalled();
    });

    it('stays as it is where the browser refuses to close the tab', () => {
      standalone();
      vi.spyOn(window, 'close').mockImplementation(() => {
        throw new Error('not closable');
      });

      expect(() => service.closePanel()).not.toThrow();
    });

    it('treats a parent it may not even look at as no host page', () => {
      Object.defineProperty(globalThis, 'parent', {
        configurable: true,
        get(): Window {
          throw new Error('cross-origin parent');
        },
      });
      const closed = vi.spyOn(window, 'close').mockImplementation(() => undefined);

      expect(service.requestDocumentContent('req-1')).toBe(false);
      service.closePanel();

      expect(closed).toHaveBeenCalled();
    });
  });
});
