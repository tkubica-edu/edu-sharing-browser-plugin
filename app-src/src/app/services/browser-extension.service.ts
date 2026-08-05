import { Injectable, signal } from '@angular/core';
import browser from 'webextension-polyfill';

/** The page an analysis was run against. */
export interface PageSource {
  url: string;
  title: string;
  favIconUrl?: string;
}

/** Reply of the background worker's `analyze.run` message. */
export interface AnalyzeResponse {
  success: boolean;
  result?: Record<string, unknown>;
  source?: PageSource;
  error?: string;
}

/**
 * Reply of the background worker's `metadata.upload` message. `success` is the *transport*: the
 * endpoint's own verdict is in `result`, which is what a caller has to check (a rejected upload —
 * e.g. a detected duplicate — is a successful request).
 */
export interface UploadResponse {
  success: boolean;
  result?: {
    success?: boolean;
    error?: string | null;
    duplicate?: boolean | null;
    node?: UploadedNode;
  };
  error?: string;
}

/**
 * The node the metadata agent created, as `/upload` reports it. Deliberately the whole thing: it is
 * everything the app knows about the new node — a guest may not read it back from the repository —
 * so the flow is seeded from this instead of from a node load (see CurationService).
 */
export interface UploadedNode {
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
   * The URL the background worker last announced for THIS tab; null until one arrives.
   *
   * It announces every URL change of the tab, **including the ones a page makes in place**: an
   * edu-sharing page routes with the History API, so its URL becomes another page's without a load —
   * this panel is never torn down and would otherwise keep working on the URL it booted with. Only
   * the worker sees that happen (see background.js, `tab.url`).
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

  /** Ask the background worker to analyze the active tab. */
  async analyzeActiveTab(language: string): Promise<AnalyzeResponse> {
    const response = (await browser.runtime.sendMessage({
      action: 'analyze.run',
      language,
    })) as AnalyzeResponse | null;
    return response ?? { success: false, error: 'NO_RESPONSE' };
  }

  /**
   * Ask the background worker to POST an upload body to the metadata agent's `/upload`, which
   * writes the curated content into the repository itself. The reply carries the endpoint's own
   * answer verbatim (see {@link UploadResponse}).
   */
  async uploadMetadata(body: Record<string, unknown>): Promise<UploadResponse> {
    const response = (await browser.runtime.sendMessage({
      action: 'metadata.upload',
      body,
    })) as UploadResponse | null;
    return response ?? { success: false, error: 'NO_RESPONSE' };
  }

  /**
   * The id of the tab this panel sits in, as the background worker sees it (`sender.tab`). Null
   * outside an extension context.
   *
   * Not the same as {@link getActiveTab}: a panel restored on a background tab would read the wrong
   * one there. Needed to keep per-tab state apart — see SessionResumeService.
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
   * Ask the host page for the content of the document it has open (OnlyOffice: the edited
   * document). The answer arrives asynchronously as a `DOCUMENT_CONTENT` message carrying the
   * same `requestId` — see OnlyOfficeDocumentService, which owns that correlation. Returns false
   * when there is no host page to ask.
   */
  requestDocumentContent(requestId: string): boolean {
    return this.postToHost({ type: 'edusharing-request-document-content', requestId });
  }

  /** Same, for the document's identity only (`DOCUMENT_INFO`, no content payload). */
  requestDocumentInfo(requestId: string): boolean {
    return this.postToHost({ type: 'edusharing-request-document-info', requestId });
  }

  /**
   * Take the active tab to `url`, and have the panel reopened on the new page.
   *
   * Driven by the background worker, not by the host page: the panel is an iframe in the page being
   * navigated, so it is destroyed by the load — the worker is the only party that outlives it and can
   * inject the panel again. What the panel was *doing* is restored separately, from storage
   * (SessionResumeService), so it comes back in the same state.
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
