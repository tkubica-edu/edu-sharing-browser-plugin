import { Injectable, signal } from '@angular/core';
import browser from 'webextension-polyfill';

import { errorMessage } from '../util/errors';

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][worker]';

/**
 * A rejection saying the message was never delivered, rather than that the action failed. The panel
 * is an iframe the page's navigation destroys and the worker puts back, so its messaging connection
 * is re-established while the panel is already on screen and able to ask — a moment during which the
 * browser answers that there is nobody there.
 *
 * Only wordings that mean *nothing ran*, because a repeated send repeats the action: „message port
 * closed before a response was received" is deliberately absent, since it also covers a listener
 * that died half way through a write, and that write may well have happened.
 */
const NOT_DELIVERED = /receiving end does not exist|could not establish connection/i;

/** How often an undelivered send is repeated, and how long after the previous attempt. */
const SEND_ATTEMPTS = 4;
const SEND_RETRY_MS = 150;

/** The error a caller gets when every attempt went undelivered — see {@link NOT_DELIVERED}. */
export const WORKER_UNREACHABLE = 'WORKER_UNREACHABLE';

/**
 * How that reads where a user sees it. Rebuilding the panel is what re-establishes the connection,
 * and reloading the extension is the way out where even that does not — in that order.
 */
export const WORKER_UNREACHABLE_TEXT =
  'Der Hintergrunddienst der Extension war nicht erreichbar. Bitte das Panel schließen und erneut ' +
  'öffnen; hilft das nicht, die Extension neu laden.';

/** What a send answers with when it was never delivered, as opposed to an answer of `null`. */
const UNREACHABLE = Symbol('worker unreachable');

/** The page the background worker says the tab is on; the title is missing while the tab has none yet. */
export interface AnnouncedPage {
  url: string;
  title: string | null;
}

/** The page an analysis was run against. */
export interface PageSource {
  url: string;
  title: string;
  favIconUrl?: string;
  /**
   * The tab as it looked when the analysis ran, as a data URL — the panel's own share of the viewport
   * already cut away (see background.js, `captureVisiblePage`). Present only for a page that names no
   * picture of its own, which is the one case the content would otherwise have none at all.
   */
  screenshot?: string;
}

/**
 * What the content script reads off the open page, as far as anything here uses it; it carries more, which
 * {@link PageData.formattedText} already contains as text. The three texts are the same page in decreasing
 * preparation: metadata blocks plus main content, that content alone, and a whole-page fallback.
 */
export interface PageData {
  url: string;
  title: string;
  mainContent?: string;
  formattedText?: string;
  text?: string;
}

/** Reply of the background worker's `analyze.run` message. */
export interface AnalyzeResponse {
  success: boolean;
  result?: Record<string, unknown>;
  source?: PageSource;
  error?: string;
}

/**
 * Reply of the background worker's `metadata.saveNode` message. `success` is the *transport*: the
 * endpoint's own verdict is in `result`, which is what a caller has to check (a refused write — a
 * node outside the endpoint's edit window, say — is a successful request).
 */
export interface SaveNodeResponse {
  success: boolean;
  result?: {
    success?: boolean;
    error?: string | null;
    /** Whether this call created the node, as opposed to updating the one it named. */
    node_created?: boolean | null;
    node?: SavedNode;
    /** The whole edu-sharing node, as the repository states it — see {@link SaveNodeResponse}. */
    node_full?: Record<string, unknown> | null;
    /** One entry per requested workflow step, in the order they ran. */
    workflow?: readonly { status?: string; success?: boolean; error?: string | null }[] | null;
    /** One entry per collection the node was to be referenced in. */
    collections?: readonly { collectionId?: string; success?: boolean; error?: string | null }[] | null;
    /** Whether the picture the body named became the node's preview — see `NodeWriteSteps.preview`. */
    preview?: { success?: boolean; error?: string | null } | null;
  };
  error?: string;
}

/**
 * Which OAuth client the worker is to run the flow against. The panel holds the configuration (see
 * OAuthService), so every message states it in full rather than the worker keeping a copy that could
 * fall behind the settings.
 */
export interface OAuthRequest {
  issuer: string;
  /**
   * The address of the provider's discovery document, where it is not the OpenID Connect one below
   * the issuer — a plain OAuth authorization server describes itself at
   * `/.well-known/oauth-authorization-server` instead. Empty leaves the issuer's own path standing.
   */
  discoveryUrl: string;
  clientId: string;
  scopes: string;
  /** The address to redirect back to, where it is configured; empty leaves the choice to the browser. */
  redirectUri: string;
  /** The repository base, which is what the redirect address falls back to without an `identity` API. */
  repositoryUrl: string;
  /** Which identity provider behind the issuer to go straight to — see `OAuthProvider.registrationId`. */
  registrationId?: string;
}

/**
 * What a completed flow yields. Only the access token comes back: the refresh token stays in the
 * worker's store, and the repository session is established here with the access token alone.
 * `signedIn` is false for the silent attempt finding nobody signed in, which is not a failure.
 */
export interface OAuthSession {
  success: boolean;
  signedIn?: boolean;
  accessToken?: string;
  expiresAt?: number | null;
  error?: string;
}

/**
 * The redirect address the flow will use, and how it will be watched for. The two flags are separate
 * because three cases read differently to whoever has to register the address: an address configured
 * here (watched for in every browser), a browser with no `identity` API (watched for as well), and
 * the address the browser's own API handed out.
 */
export interface RedirectUriInUse {
  readonly redirectUri: string;
  /** Whether `launchWebAuthFlow` is what will show the provider's pages for this address. */
  readonly usesIdentityApi: boolean;
  /** Whether the browser has the API at all — false only on Safari. */
  readonly hasIdentityApi: boolean;
}

/**
 * What the issuer says about itself, asked before a flow is run. `unsupportedScopes` is empty both
 * for scopes that are all fine and for an issuer that lists none of its own — `scopesSupported` is
 * what tells those apart.
 */
export interface IssuerCheck {
  readonly revocable: boolean;
  readonly scopesSupported: readonly string[] | null;
  readonly unsupportedScopes: readonly string[];
}

/**
 * The node the metadata agent wrote, as `/nodes` reports it. Deliberately the whole thing: along
 * that route it is everything the app knows about the node — a guest may not read it back from the
 * repository — so the flow is seeded from this instead of from a node load (see CurationService).
 */
export interface SavedNode {
  nodeId?: string;
  title?: string | null;
  description?: string | null;
  wwwurl?: string | null;
  /** Link into the repository UI (`…/components/render/<id>`). */
  repositoryUrl?: string | null;
}

// Wrapper over the WebExtension APIs this app needs: background messaging, local storage and
// postMessage to the host page. Privileged work (reading the tab, calling the metadata agent)
// is delegated to the background worker to stay CORS-portable across browsers.
@Injectable({ providedIn: 'root' })
export class BrowserExtensionService {
  /** Whether we appear to be inside the extension (vs. a plain dev server). */
  readonly available = typeof browser !== 'undefined' && !!browser.runtime?.id;

  /**
   * The page the background worker last announced for this tab; null until one arrives. It announces every
   * change including the ones a page makes in place — an edu-sharing page routes with the History API, and
   * only the worker sees that happen, so this panel would otherwise keep working on the page it booted with.
   * URL and title together, so a reader sees one page rather than two halves of two.
   */
  readonly announcedPage = signal<AnnouncedPage | null>(null);

  /** This panel's tab, for telling its own announcements from another tab's; null while unknown. */
  private ownTabId: number | null = null;

  constructor() {
    if (!this.available) return;
    // Resolved once, up front: the announcement is a broadcast to every panel, so it has to be
    // matched against this one's tab. While the id is unknown — a panel opened as its own tab, a
    // plain dev server — there is only one panel anyway, so every announcement is its own.
    void this.getOwnTabId().then((tabId) => (this.ownTabId = tabId));
    browser.runtime.onMessage.addListener((message: unknown) => {
      const announcement = message as
        | { action?: string; tabId?: number; url?: string; title?: string }
        | null;
      if (announcement?.action !== 'tab.url' || !announcement.url) return;
      if (this.ownTabId !== null && announcement.tabId !== this.ownTabId) return;
      this.announcedPage.set({ url: announcement.url, title: announcement.title ?? null });
    });
  }

  /**
   * Ask the background worker to analyze the active tab. `apiUrl` names which metadata agent to call: it
   * follows from the configured repository, which only the panel knows — told nothing, the worker falls
   * back to the agent's public deployment.
   */
  async analyzeActiveTab(language: string, apiUrl?: string): Promise<AnalyzeResponse> {
    const response = await this.ask<AnalyzeResponse>({ action: 'analyze.run', language, apiUrl });
    if (response === UNREACHABLE) return { success: false, error: WORKER_UNREACHABLE };
    return response ?? { success: false, error: 'NO_RESPONSE' };
  }

  /**
   * Ask the background worker to run the metadata agent on a page named by its address, rather than on
   * the tab that is open — for a content whose page the browser is not showing. The agent fetches the
   * page itself, so no tab is involved at all.
   */
  async analyzeUrl(url: string, language: string, title?: string | null, apiUrl?: string): Promise<AnalyzeResponse> {
    const response = (await browser.runtime.sendMessage({
      action: 'analyze.url',
      url,
      title,
      language,
      apiUrl,
    })) as AnalyzeResponse | null;
    return response ?? { success: false, error: 'NO_RESPONSE' };
  }

  /**
   * Ask the background worker to POST a node body to the metadata agent's `/nodes`, which writes the
   * curated content into the repository itself. The reply carries the endpoint's answer verbatim.
   */
  async saveNode(body: Record<string, unknown>, apiUrl?: string): Promise<SaveNodeResponse> {
    const response = await this.ask<SaveNodeResponse>({ action: 'metadata.saveNode', body, apiUrl });
    if (response === UNREACHABLE) return { success: false, error: WORKER_UNREACHABLE };
    return response ?? { success: false, error: 'NO_RESPONSE' };
  }

  /**
   * Hand a message to the background worker and answer what it replies. A send that was never delivered
   * is repeated ({@link NOT_DELIVERED}), since that is the panel's connection settling rather than a
   * refusal, and answered with {@link UNREACHABLE} once the attempts are used up. Every other
   * rejection is the worker's own and is passed on to the caller.
   */
  private async ask<T>(message: Record<string, unknown>): Promise<T | null | typeof UNREACHABLE> {
    if (!this.available) return UNREACHABLE;
    for (let attempt = 1; ; attempt++) {
      try {
        return ((await browser.runtime.sendMessage(message)) ?? null) as T | null;
      } catch (cause: unknown) {
        const reason = errorMessage(cause);
        if (!NOT_DELIVERED.test(reason)) throw cause;
        if (attempt >= SEND_ATTEMPTS) {
          console.warn(`${LOG} «${message['action']}» not delivered in ${attempt} attempts:`, reason);
          return UNREACHABLE;
        }
        console.warn(`${LOG} «${message['action']}» not delivered (attempt ${attempt}), retrying:`, reason);
        await new Promise((resolve) => setTimeout(resolve, SEND_RETRY_MS * attempt));
      }
    }
  }

  /** Same, for a caller to which an unreachable worker and an answer of `null` are the same thing. */
  private async askOrNull<T>(message: Record<string, unknown>): Promise<T | null> {
    const answer = await this.ask<T>(message).catch(() => null);
    return answer === UNREACHABLE ? null : answer;
  }


  /**
   * The id of the tab this panel sits in, as the background worker sees it; null outside an extension
   * context. Not {@link getActiveTab}: a panel restored on a background tab would read the wrong one, and
   * per-tab state has to be kept apart (see SessionResumeService).
   */
  async getOwnTabId(): Promise<number | null> {
    const response = await this.askOrNull<{ tabId?: number | null }>({ action: 'tabs.self' });
    return typeof response?.tabId === 'number' ? response.tabId : null;
  }

  async getActiveTab(): Promise<PageSource | null> {
    const response = await this.askOrNull<{ success?: boolean; tab?: PageSource }>({
      action: 'tabs.getActive',
    });
    return response?.success ? response.tab ?? null : null;
  }

  /**
   * Read the open page, by injecting the content script into it. `null` for a page that cannot be read
   * at all — an extension or browser page, one whose injection the browser refuses — which is a
   * possible outcome rather than an error: what needs the page's text says so itself.
   */
  async extractPageData(): Promise<PageData | null> {
    const response = await this.askOrNull<{ success?: boolean; data?: PageData }>({
      action: 'tabs.extractPageData',
    });
    return response?.success ? response.data ?? null : null;
  }

  /**
   * Have the worker run the interactive OAuth flow — the IdP's pages are shown, and the access token
   * it ends with comes back. In the worker because this panel is an iframe the host page's navigation
   * destroys, which would take the flow with it (see `background/oauth.js`).
   */
  oauthLogin(request: OAuthRequest): Promise<OAuthSession> {
    return this.askOAuth('oauth.login', request);
  }

  /** The same without showing anything, from the refresh token the worker kept. */
  oauthSilent(request: OAuthRequest): Promise<OAuthSession> {
    return this.askOAuth('oauth.silent', request);
  }

  /**
   * Ask the worker what the configured issuer says about itself. Rejects with the flow's own codes
   * where the issuer cannot be reached or describes no endpoints, so the caller can report the same
   * sentences a failed login would.
   */
  async oauthCheckIssuer(request: OAuthRequest): Promise<IssuerCheck> {
    const answer = await this.ask<IssuerCheck & { success: boolean; error?: string }>({
      action: 'oauth.checkIssuer',
      ...request,
    });
    if (answer === UNREACHABLE) throw new Error(WORKER_UNREACHABLE);
    if (!answer?.success) throw new Error(answer?.error || 'NO_RESPONSE');
    return { revocable: answer.revocable, scopesSupported: answer.scopesSupported, unsupportedScopes: answer.unsupportedScopes };
  }

  /** Drop the worker's OAuth session and have the issuer revoke the refresh token where it can. */
  oauthLogout(request: OAuthRequest): Promise<OAuthSession> {
    return this.askOAuth('oauth.logout', request);
  }

  /**
   * The address that has to be registered with the client at the IdP. Asked of the worker rather than
   * worked out here: with the `identity` API it is an address the browser makes up per extension.
   * Null where the worker cannot say — no extension around it, or no repository to derive one from.
   */
  async oauthRedirectUri(request: OAuthRequest): Promise<RedirectUriInUse | null> {
    const answer = await this.askOrNull<{
      success?: boolean;
      redirectUri?: string;
      usesIdentityApi?: boolean;
      hasIdentityApi?: boolean;
    }>({ action: 'oauth.redirectUri', ...request });
    if (!answer?.success || !answer.redirectUri) return null;
    return {
      redirectUri: answer.redirectUri,
      usesIdentityApi: answer.usesIdentityApi === true,
      hasIdentityApi: answer.hasIdentityApi === true,
    };
  }

  /**
   * One of the three OAuth messages. An unreachable worker is reported as such rather than as a
   * refused login: the flow never ran, and the two read differently to whoever is trying to sign in.
   */
  private async askOAuth(action: string, request: OAuthRequest): Promise<OAuthSession> {
    const response = await this.ask<OAuthSession>({ action, ...request });
    if (response === UNREACHABLE) return { success: false, error: WORKER_UNREACHABLE };
    return response ?? { success: false, error: 'NO_RESPONSE' };
  }

  async storageGet<T>(key: string, fallback: T): Promise<T> {
    if (!this.available) return fallback;
    const items = await browser.storage.local.get({ [key]: fallback });
    return items[key] as T;
  }

  async storageSet(key: string, value: unknown): Promise<void> {
    if (!this.available) return;
    await browser.storage.local.set({ [key]: value });
  }

  /** Forward selected edu-sharing node(s) to the host page (e.g. OnlyOffice). */
  insertNodes(nodes: unknown[]): void {
    this.postToHost({ type: 'edusharing-insert-node', nodes });
  }

  /**
   * Ask the host page for the content of the document it has open. The answer arrives asynchronously as a
   * `DOCUMENT_CONTENT` message with the same `requestId` (see OnlyOfficeDocumentService). False when there
   * is no host page to ask.
   */
  requestDocumentContent(requestId: string): boolean {
    return this.postToHost({ type: 'edusharing-request-document-content', requestId });
  }

  /** Same, for the document's identity only (`DOCUMENT_INFO`, no content payload). */
  requestDocumentInfo(requestId: string): boolean {
    return this.postToHost({ type: 'edusharing-request-document-info', requestId });
  }

  /**
   * Take the active tab to `url` and have the panel reopened there. Driven by the background worker rather
   * than by the host page: the panel is an iframe in the page being navigated, so only the worker outlives
   * the load. What it was doing is restored separately (SessionResumeService).
   */
  async navigateTab(url: string): Promise<void> {
    // Reported rather than swallowed: the caller saved its state for a load that would then never
    // happen, and the panel would sit on a screen waiting for a page that never comes.
    if ((await this.ask({ action: 'tabs.navigate', url })) === UNREACHABLE) {
      throw new Error(WORKER_UNREACHABLE);
    }
  }

  /** Tell the host page the sidebar has booted, so it can replay a buffered inbound event. */
  signalReady(): void {
    this.postToHost({ type: 'edusharing-sidebar-ready' });
  }

  /** Close the injected panel by messaging the host page; fall back to closing a tab. */
  closePanel(): void {
    if (this.postToHost({ type: 'edusharing-panel-close' })) return;
    try {
      window.close();
    } catch {
      /* not closable — ignore */
    }
  }

  /** Post a message to the embedding page. Returns false when there is no host page. */
  private postToHost(message: { type: string; [key: string]: unknown }): boolean {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        return true;
      }
    } catch {
      /* cross-origin parent — treat as unreachable */
    }
    return false;
  }
}
