import { Injectable, signal } from '@angular/core';
import browser from 'webextension-polyfill';

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
   * The URL the background worker last announced for this tab; null until one arrives. It announces every
   * change including the ones a page makes in place — an edu-sharing page routes with the History API, and
   * only the worker sees that happen, so this panel would otherwise keep working on its boot URL.
   */
  readonly announcedUrl = signal<string | null>(null);

  /** This panel's tab, for telling its own announcements from another tab's; null while unknown. */
  private ownTabId: number | null = null;

  constructor() {
    if (!this.available) return;
    // Resolved once, up front: the announcement is a broadcast to every panel, so it has to be
    // matched against this one's tab. While the id is unknown — a panel opened as its own tab, a
    // plain dev server — there is only one panel anyway, so every announcement is its own.
    void this.getOwnTabId().then((tabId) => (this.ownTabId = tabId));
    browser.runtime.onMessage.addListener((message: unknown) => {
      const announcement = message as { action?: string; tabId?: number; url?: string } | null;
      if (announcement?.action !== 'tab.url' || !announcement.url) return;
      if (this.ownTabId !== null && announcement.tabId !== this.ownTabId) return;
      this.announcedUrl.set(announcement.url);
    });
  }

  /**
   * Ask the background worker to analyze the active tab. `apiUrl` names which metadata agent to call: it
   * follows from the configured repository, which only the panel knows — told nothing, the worker falls
   * back to the agent's public deployment.
   */
  async analyzeActiveTab(language: string, apiUrl?: string): Promise<AnalyzeResponse> {
    const response = (await browser.runtime.sendMessage({
      action: 'analyze.run',
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
    const response = (await browser.runtime.sendMessage({
      action: 'metadata.saveNode',
      body,
      apiUrl,
    })) as SaveNodeResponse | null;
    return response ?? { success: false, error: 'NO_RESPONSE' };
  }


  /**
   * The id of the tab this panel sits in, as the background worker sees it; null outside an extension
   * context. Not {@link getActiveTab}: a panel restored on a background tab would read the wrong one, and
   * per-tab state has to be kept apart (see SessionResumeService).
   */
  async getOwnTabId(): Promise<number | null> {
    const response = (await browser.runtime
      .sendMessage({ action: 'tabs.self' })
      .catch(() => null)) as { tabId?: number | null } | null;
    return typeof response?.tabId === 'number' ? response.tabId : null;
  }

  async getActiveTab(): Promise<PageSource | null> {
    const response = (await browser.runtime.sendMessage({ action: 'tabs.getActive' })) as
      | { success?: boolean; tab?: PageSource }
      | null;
    return response?.success ? response.tab ?? null : null;
  }

  /**
   * Read the open page, by injecting the content script into it. `null` for a page that cannot be read
   * at all — an extension or browser page, one whose injection the browser refuses — which is a
   * possible outcome rather than an error: what needs the page's text says so itself.
   */
  async extractPageData(): Promise<PageData | null> {
    const response = (await browser.runtime
      .sendMessage({ action: 'tabs.extractPageData' })
      .catch(() => null)) as { success?: boolean; data?: PageData } | null;
    return response?.success ? response.data ?? null : null;
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
    await browser.runtime.sendMessage({ action: 'tabs.navigate', url });
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
