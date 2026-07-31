import { Injectable, inject, signal } from '@angular/core';

import { BrowserExtensionService } from './browser-extension.service';

/**
 * Identity of the document the host has open, as announced by the OnlyOffice plugin. Present on
 * every inbound envelope (envelope level, `data` for DOCUMENT_INFO) and `null` when the editor
 * was opened with a stale plugin config — so always treat it as optional.
 */
export interface DocumentIdentity {
  nodeId?: string;
  repoId?: string;
  /** For collection references: the real, edited node. */
  originalId?: string | null;
  name?: string;
  title?: string;
  mimeType?: string;
  permaLink?: string;
  contentVersion?: string;
  /** Whether the user may write in this session. */
  editable?: boolean;
  /** OnlyOffice document key = the collaboration session. */
  documentKey?: string;
}

/**
 * The `DOCUMENT_CONTENT` payload. Only the fields this app consumes are typed — `markdown` is
 * the one it feeds to the metadata agent; `html`, `documentJson`, `elements` etc. are carried
 * along untyped. Answers can also be one of the two error forms.
 */
export interface DocumentContent {
  trigger?: 'toolbar' | 'request';
  requestId?: string;
  editorType?: string;
  title?: string;
  text?: string;
  markdown?: string;
  document?: DocumentIdentity | null;
  /** Set when the editor is not a text document (spreadsheet, presentation). */
  unsupported?: boolean;
  /** Set when the plugin failed to read the document. */
  error?: string;
  [field: string]: unknown;
}

/** An inbound envelope relayed by content/panel-host.js. */
export interface PluginEnvelope {
  event?: string;
  data?: DocumentContent;
  document?: DocumentIdentity | null;
}

/** How long we wait for an answer before giving up on a request. */
const CONTENT_TIMEOUT_MS = 15000;
const INFO_TIMEOUT_MS = 10000;

const NO_HOST =
  'Die Seite konnte nicht erreicht werden — bitte das Panel auf der OnlyOffice-Seite öffnen.';
const TIMEOUT =
  'Keine Antwort vom OnlyOffice-Plugin. Ist das edu-sharing-Plugin (Plugins im Hintergrund) aktiv?';
const UNSUPPORTED = 'Nur Textdokumente können ausgelesen werden (keine Tabellen/Präsentationen).';
const READ_FAILED = 'Das Dokument konnte nicht ausgelesen werden.';

/**
 * Request/response bridge to the document the host page has open (the OnlyOffice plugin).
 *
 * Requests are sent through the panel host (`BrowserExtensionService`) and correlated by
 * `requestId`, because several may be in flight and the answer is a plain window message. The
 * plugin is an optional background plugin, so every request is bounded by a timeout — without
 * it a disabled plugin would leave the caller hanging forever.
 *
 * Inbound envelopes are not read here: `AppComponent` owns the single `window:message` listener
 * and hands the DOCUMENT_* events to {@link accept}.
 */
@Injectable({ providedIn: 'root' })
export class OnlyOfficeDocumentService {
  private readonly browserExtension = inject(BrowserExtensionService);

  /**
   * Identity of the document currently open in the host, from the plugin's announce on startup
   * or from any later answer. `null` until something has been received (or when the plugin
   * itself reports no identity).
   */
  readonly currentDocument = signal<DocumentIdentity | null>(null);

  private readonly pending = new Map<string, (answer: DocumentContent) => void>();
  private requestCounter = 0;

  /**
   * Ask for the open document's content and resolve with the plugin's answer. Rejects with a
   * user-facing message when there is no host page, the plugin does not answer in time, or it
   * reports an unsupported editor / a read failure.
   */
  requestContent(): Promise<DocumentContent> {
    return this.request(
      (requestId) => this.browserExtension.requestDocumentContent(requestId),
      CONTENT_TIMEOUT_MS,
    ).then((answer) => {
      if (answer.unsupported) throw new Error(UNSUPPORTED);
      if (answer.error) throw new Error(READ_FAILED);
      return answer;
    });
  }

  /** Ask for the open document's identity only. Same failure modes as {@link requestContent}. */
  requestInfo(): Promise<DocumentIdentity | null> {
    return this.request(
      (requestId) => this.browserExtension.requestDocumentInfo(requestId),
      INFO_TIMEOUT_MS,
    ).then((answer) => answer.document ?? null);
  }

  /**
   * Take a `DOCUMENT_INFO` / `DOCUMENT_CONTENT` envelope: remember the document identity and
   * resolve the matching request. Returns false for envelopes this service does not handle, so
   * the caller can keep routing.
   */
  accept(envelope: PluginEnvelope): boolean {
    if (envelope.event !== 'DOCUMENT_INFO' && envelope.event !== 'DOCUMENT_CONTENT') return false;
    const answer: DocumentContent = envelope.data ?? {};
    // The identity sits on the envelope for every event and additionally in `data` for
    // DOCUMENT_INFO. A stale plugin config sends null — then the last known identity is kept,
    // since a null tells us nothing new.
    const document = envelope.document ?? answer.document ?? null;
    if (document) this.currentDocument.set(document);

    // An unsolicited answer (the plugin's toolbar button, or its startup announce) has no
    // waiting caller — the identity above is all we take from it.
    const resolve = answer.requestId ? this.pending.get(answer.requestId) : undefined;
    if (resolve) resolve({ ...answer, document });
    return true;
  }

  /** Send a request under a fresh id and wait for its answer, bounded by `timeoutMs`. */
  private request(
    send: (requestId: string) => boolean,
    timeoutMs: number,
  ): Promise<DocumentContent> {
    const requestId = `es-${Date.now()}-${++this.requestCounter}`;
    return new Promise<DocumentContent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(TIMEOUT));
      }, timeoutMs);

      this.pending.set(requestId, (answer) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(answer);
      });

      if (!send(requestId)) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error(NO_HOST));
      }
    });
  }
}
