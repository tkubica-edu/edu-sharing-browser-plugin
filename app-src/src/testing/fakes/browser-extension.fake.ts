import { signal } from '@angular/core';
import { vi } from 'vitest';

import {
  AnalyzeResponse,
  AnnouncedPage,
  BrowserExtensionService,
  OAuthDiscovery,
  OAuthRequest,
  OAuthSession,
  PageData,
  PageReadResponse,
  PageSource,
  SaveNodeResponse,
} from '../../app/services/browser-extension.service';

/**
 * `BrowserExtensionService` with its extension APIs replaced: `storage.local` becomes an in-memory
 * map, and everything that would leave the panel is a spy that does nothing. It is the wrapper 15
 * services depend on, so this fake is what keeps `browser.*` out of the whole test run.
 */
export function fakeBrowserExtension() {
  /** Stands in for `storage.local`, so a `load()` can be given what a previous session wrote. */
  const storage = new Map<string, unknown>();

  // Spied separately and cast at the property below: `storageGet` is generic in its fallback, and a
  // vitest `Mock` erases the type parameter — so this is the one member the `satisfies` check cannot
  // carry. Its signature is repeated here by hand instead.
  const storageGet = vi.fn(
    (key: string, fallback: unknown): Promise<unknown> =>
      Promise.resolve(storage.has(key) ? storage.get(key) : fallback),
  );

  /** What the repository answers about its authorization server — see {@link federates}. */
  let oauthDiscovery: () => Promise<OAuthDiscovery> = () =>
    Promise.reject(new Error('OAUTH_DISCOVERY_FAILED: 404 Not Found'));

  /** What the worker answers a `metadata.saveNode` with — see {@link writes} and {@link refuses}. */
  let saved: SaveNodeResponse = { success: true, result: { success: true } };

  /** What the worker answers the interactive OAuth flow with — see {@link oauthYields}. */
  let oauthLogin: OAuthSession = { success: false, error: 'OAUTH_CANCELLED' };
  /** And the silent one, whose default is the ordinary case of nobody being signed in. */
  let oauthSilent: OAuthSession = { success: true, signedIn: false };

  /** The tab `tabs.getActive` reports; null is a browser showing no page the panel may read. */
  let activeTab: PageSource | null = null;

  /**
   * The tab this panel is in. Null is the ordinary case for a spec — the sidebar opened as its own tab
   * or a plain dev server, where the per-tab storage keys collapse into one.
   */
  let ownTabId: number | null = null;

  /**
   * What the worker answers a run of the metadata agent with — for the open tab and for a named
   * address alike, since both are the same statement about the same kind of thing. The default is the
   * failure the worker reports when the panel and the worker come from different builds.
   */
  let analyzed: AnalyzeResponse = { success: false, error: 'NO_RESPONSE' };

  /** What `page.read` answers with; null is a page the content script could not be injected into. */
  let pageRead: PageReadResponse | null = null;

  /** What `tabs.extractPageData` answers with — the open page alone, without the record of where. */
  let extracted: PageData | null = null;

  /**
   * Whether there is a host page around the panel to post to — the OnlyOffice page it is docked in.
   * True by default, since the messages only exist for a panel that has one; {@link standalone} is
   * the panel opened as a tab of its own, where every one of them reaches nobody.
   */
  let hosted = true;

  const fake = {
    available: true,
    announcedPage: signal<AnnouncedPage | null>(null),
    storageGet: storageGet as unknown as BrowserExtensionService['storageGet'],
    storageSet: vi.fn((key: string, value: unknown): Promise<void> => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    navigateTab: vi.fn((): Promise<void> => Promise.resolve()),
    getActiveTab: vi.fn((): Promise<PageSource | null> => Promise.resolve(activeTab)),
    getOwnTabId: vi.fn((): Promise<number | null> => Promise.resolve(ownTabId)),
    analyzeActiveTab: vi.fn(
      (_language: string, _apiUrl?: string): Promise<AnalyzeResponse> => Promise.resolve(analyzed),
    ),
    analyzeUrl: vi.fn(
      (_url: string, _language: string, _title?: string | null, _apiUrl?: string): Promise<AnalyzeResponse> =>
        Promise.resolve(analyzed),
    ),
    readPage: vi.fn((): Promise<PageReadResponse | null> => Promise.resolve(pageRead)),
    extractPageData: vi.fn((): Promise<PageData | null> => Promise.resolve(extracted)),
    openWindow: vi.fn((_url: string): Promise<void> => Promise.resolve()),
    openTab: vi.fn((_url: string, _options?: { active?: boolean }): Promise<void> => Promise.resolve()),
    saveNode: vi.fn(
      (_body: Record<string, unknown>, _apiUrl?: string): Promise<SaveNodeResponse> =>
        Promise.resolve(saved),
    ),
    oauthLogin: vi.fn((_request: OAuthRequest): Promise<OAuthSession> => Promise.resolve(oauthLogin)),
    oauthSilent: vi.fn((_request: OAuthRequest): Promise<OAuthSession> => Promise.resolve(oauthSilent)),
    oauthLogout: vi.fn((_request: OAuthRequest): Promise<OAuthSession> => Promise.resolve({ success: true })),
    // Refuses by default, which is the ordinary repository: one that publishes no authorization
    // server, so the panel offers the credential form. `federates` is what turns it round.
    oauthDiscover: vi.fn(
      (_request: OAuthRequest): Promise<OAuthDiscovery> => oauthDiscovery(),
    ),
    insertNodes: vi.fn((_nodes: unknown[]): void => undefined),
    requestDocumentContent: vi.fn((_requestId: string): boolean => hosted),
    requestDocumentInfo: vi.fn((_requestId: string): boolean => hosted),
    signalReady: vi.fn(),
    closePanel: vi.fn(),
    oauthRedirectUri: vi.fn((_request: OAuthRequest) =>
      Promise.resolve({
        redirectUri: 'https://abc.chromiumapp.org/',
        usesIdentityApi: true,
      }),
    ),
  } satisfies Partial<BrowserExtensionService>;

  /**
   * What the endpoint reports for the next write. Its own verdict, one level in under `result` — the
   * transport succeeded, which is the case every write path is read for.
   */
  function writes(result: SaveNodeResponse['result']): void {
    saved = { success: true, result };
  }

  /** The message never reached a worker: the *transport* failed, and it says nothing about the write. */
  function refuses(error: string): void {
    saved = { success: false, error };
  }

  /**
   * The repository publishes an authorization server, so the SSO login is the way in — the state
   * `OAuthService.probe` reads and everything about the flow is gated on.
   */
  function federates(server: Partial<OAuthDiscovery> = {}): void {
    oauthDiscovery = () =>
      Promise.resolve({
        discoveryUrl: 'https://repo.example/edu-sharing/.well-known/oauth-authorization-server',
        issuer: 'https://repo.example/edu-sharing',
        revocable: true,
        sessionEndable: true,
        scopesSupported: null,
        unsupportedScopes: [],
        ...server,
      });
  }

  /** The worker's OAuth flow ends in this token — the completed-flow case. */
  function oauthYields(accessToken: string): void {
    oauthLogin = { success: true, accessToken };
  }

  /** It ends without one instead: a cancellation, or one of the flow's own refusals. */
  function oauthRefuses(error: string): void {
    oauthLogin = { success: false, error };
  }

  /** Somebody is still signed in, so the silent attempt answers with a token. */
  function oauthResumes(accessToken: string): void {
    oauthSilent = { success: true, signedIn: true, accessToken };
  }

  /** The browser is showing this page — what `tabs.getActive` reports. */
  function showing(tab: PageSource | null): void {
    activeTab = tab;
  }

  /** No page is embedding the panel, so nothing posted to a host reaches anybody. */
  function standalone(): void {
    hosted = false;
  }

  /** The panel sits in this tab, so everything it stores per tab is keyed by it. */
  function inTab(tabId: number | null): void {
    ownTabId = tabId;
  }

  /** The agent answered with this payload, for the page described by `source`. */
  function analyzes(result: Record<string, unknown>, source: PageSource, data?: unknown): void {
    analyzed = { success: true, result, source, data: data as AnalyzeResponse['data'] };
  }

  /** It did not: the worker reports this error instead, which is the branch the messages are written for. */
  function refusesAnalysis(error: string): void {
    analyzed = { success: false, error };
  }

  /** The content script read the page, and this is what it found. */
  function reads(page: PageReadResponse): void {
    pageRead = page;
    extracted = page.data ?? null;
  }

  /** The open page alone, for the callers that ask only for its content. */
  function extracts(page: PageData | null): void {
    extracted = page;
  }

  return {
    fake,
    storage,
    storageGet,
    writes,
    refuses,
    federates,
    oauthYields,
    oauthRefuses,
    oauthResumes,
    showing,
    analyzes,
    refusesAnalysis,
    reads,
    extracts,
    inTab,
    standalone,
  };
}

export type BrowserExtensionFake = ReturnType<typeof fakeBrowserExtension>;
