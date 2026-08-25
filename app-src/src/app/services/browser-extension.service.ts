import { Injectable, inject, signal } from '@angular/core';
import browser from 'webextension-polyfill';

import { PdfTextService, formatPdfText, looksLikePdf } from './pdf-text.service';
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

  private readonly pdfText = inject(PdfTextService);

  /** The last PDF tab that was read, by address; `text` is null for one that carries none. */
  private lastPdf: { url: string; text: string | null } | null = null;

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
    // A PDF is read here and handed over as text, because it can only be read here: the worker may
    // start no worker of its own, which is what pdf.js needs (see {@link pdfTextOfTab}).
    const pdfText = await this.pdfTextOfTab(null, false);
    const response = await this.ask<AnalyzeResponse>({
      action: 'analyze.run',
      language,
      apiUrl,
      ...(pdfText ? { pdfText } : {})
    });
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
    const data = response?.success ? response.data ?? null : null;
    if (!data) return null;
    // A PDF tab reads as an empty page: the browser shows the document in a plugin of its own, and a
    // content script injected into the tab finds an `<embed>` and no text at all. The text is the
    // document's own, read here.
    const pdfText = await this.pdfTextOfTab(data.url, hasPageText(data));
    return pdfText ? { ...data, mainContent: pdfText, formattedText: pdfText } : data;
  }

  /**
   * The text of the open tab where that tab is a PDF, else null. Read in this document because pdf.js
   * needs a worker and the background service worker may start none — and read at all because the text
   * would otherwise be missing entirely, leaving the metadata agent to fetch the document itself.
   *
   * Kept for the address it was read from: one page is erschlossen and judged in the same breath, and
   * reading a document of many pages twice for that would double the wait for nothing.
   */
  private async pdfTextOfTab(url: string | null, pageHasText: boolean): Promise<string | null> {
    const address = url ?? (await this.getActiveTab())?.url ?? null;
    if (!address || pageHasText) return null;
    if (this.lastPdf?.url === address) return this.lastPdf.text;
    // The address is the cheap half of the question and answers it for most documents; a page that
    // read as empty is asked outright, since a PDF is served under any address a server likes.
    if (!looksLikePdf(address) && !(await servesPdf(address))) {
      // Remembered as "no document here", so a page erschlossen and judged in one flow is asked once.
      this.lastPdf = { url: address, text: null };
      return null;
    }
    try {
      const pdf = await this.pdfText.readUrl(address);
      // A scanned document has no text layer: pdf.js reads it and finds nothing, and nothing is what
      // the agent is then better off not being handed — it falls back to fetching the page itself.
      const text = pdf.text.trim() ? formatPdfText(pdf) : null;
      console.log(
        `${LOG} PDF read on the device: ${pdf.pagesRead}/${pdf.pages} pages,`,
        text ? `${text.length} characters` : 'no text layer — a scan, most likely',
      );
      this.lastPdf = { url: address, text };
      return text;
    } catch (cause: unknown) {
      // A document that cannot be read is one source of text missing, not a failed extraction: the
      // caller carries on with what the page itself says.
      console.warn(`${LOG} the PDF of the open tab could not be read:`, errorMessage(cause));
      this.lastPdf = { url: address, text: null };
      return null;
    }
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

/** Whether an extraction found text worth calling the page's own — see {@link BrowserExtensionService.extractPageData}. */
function hasPageText(data: PageData): boolean {
  return (data.mainContent ?? data.formattedText ?? data.text ?? '').trim().length > 0;
}

/**
 * Whether the server answers with a PDF under this address. Asked only where the address itself does not
 * say so and the page read as empty — a document served under a plain address, which is what a repository
 * or a CMS does. A server that refuses the question is taken at its silence.
 */
async function servesPdf(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', credentials: 'include' });
    return /application\/pdf/i.test(response.headers.get('content-type') ?? '');
  } catch {
    return false;
  }
}
