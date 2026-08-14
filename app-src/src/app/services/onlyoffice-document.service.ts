import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Node, RestConstants } from 'ngx-edu-sharing-api';

import {
  DocumentContent,
  DocumentIdentity,
  DocumentRequestKind,
  PluginEnvelope,
} from '../model/onlyoffice-events';
import { renderLink } from '../util/repository-links';
import { AuthService } from './auth.service';
import { BrowserExtensionService } from './browser-extension.service';
import { DebugService } from './debug.service';
import { RepositoryNodeService } from './repository-node.service';

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
 * Request/response bridge to the document the host page has open. Requests are correlated by `requestId`, since
 * several may be in flight and the answer is a plain window message, and each is bounded by a timeout, because a
 * switched-off plugin never replies. The plugin reports only the node id, so this loads that node once.
 */
@Injectable({ providedIn: 'root' })
export class OnlyOfficeDocumentService {
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly repositoryNodes = inject(RepositoryNodeService);
  private readonly auth = inject(AuthService);
  private readonly debug = inject(DebugService);

  /**
   * Identity of the document currently open in the host, from the plugin's announce on startup
   * or from any later answer. `null` until something has been received (or when the plugin
   * itself reports no identity).
   */
  readonly currentDocument = signal<DocumentIdentity | null>(null);

  private readonly node = signal<Node | null>(null);

  /**
   * The open document's repository node, loaded from {@link currentDocument}. `null` while it is
   * unknown — the panel is often opened logged out, and the load is best effort.
   */
  readonly documentNode = this.node.asReadonly();

  /** Node id {@link documentNode} was loaded for, so the same node is not fetched twice. */
  private hydratedFor: string | null = null;

  /** Title for display: the node's, else its file name, else the bare id. */
  readonly documentTitle = computed(
    () =>
      this.node()?.title || this.node()?.name || this.currentDocument()?.nodeId || null,
  );

  /**
   * The document's permalink. Falls back to its page in the repository UI while the node is not
   * loaded, so the source line always links somewhere.
   */
  readonly documentPermaLink = computed(() => {
    const permalink = this.node()?.properties?.['virtual:permalink']?.[0];
    if (permalink) return permalink;
    const nodeId = this.currentDocument()?.nodeId;
    return nodeId ? renderLink(this.auth.repositoryUrl(), nodeId) : null;
  });

  /**
   * Whether the metadata may be saved onto the document. **`null` means unknown** (node not
   * loaded) — callers must not warn about missing permission in that case.
   */
  readonly documentWritable = computed(() => {
    const node = this.node();
    return node ? node.access.includes(RestConstants.ACCESS_WRITE) : null;
  });

  private readonly pending = new Map<string, (answer: DocumentContent) => void>();
  private requestCounter = 0;

  constructor() {
    // The panel is usually opened before login, when the node cannot be fetched. Retry as soon
    // as a session exists.
    effect(() => {
      if (this.auth.authorized() && this.currentDocument() && !this.node()) this.hydrate();
    });
  }

  /**
   * Ask for the open document's content and resolve with the plugin's answer. Rejects with a
   * user-facing message when there is no host page, the plugin does not answer in time, or it
   * reports an unsupported editor / a read failure.
   */
  requestContent(): Promise<DocumentContent> {
    return this.request('content', CONTENT_TIMEOUT_MS).then((answer) => {
      if (answer.unsupported) throw new Error(UNSUPPORTED);
      if (answer.error) throw new Error(READ_FAILED);
      return answer;
    });
  }

  /** Ask for the open document's identity only. Same failure modes as {@link requestContent}. */
  requestInfo(): Promise<DocumentIdentity | null> {
    return this.request('info', INFO_TIMEOUT_MS).then((answer) => answer.document ?? null);
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

    // An unsolicited answer (the plugin's toolbar button, a double-click in the editor, or its
    // startup announce) has no waiting caller.
    const resolve = answer.requestId ? this.pending.get(answer.requestId) : undefined;

    // An unsolicited DOCUMENT_CONTENT is dropped entirely: nobody asked for it, and taking its
    // identity would make that document the active node — throwing the user out of whatever they
    // were doing (a double-click in the editor fires one). Only DOCUMENT_INFO still announces the
    // open document. Remove this guard to get the old behaviour back.
    if (envelope.event === 'DOCUMENT_CONTENT' && !resolve) return true;

    if (document) {
      this.currentDocument.set(document);
      this.hydrate();
    }

    if (resolve) resolve({ ...answer, document });
    return true;
  }

  /**
   * Load the open document's node, so title, permalink and write permission are available. Best
   * effort and fire-and-forget: without a session the fetch cannot work, and a failure only
   * means the derived values fall back to the bare node id.
   */
  private hydrate(): void {
    const nodeId = this.currentDocument()?.nodeId;
    if (!nodeId || nodeId === this.hydratedFor || !this.auth.authorized()) return;
    this.hydratedFor = nodeId;
    if (this.node()?.ref.id !== nodeId) this.node.set(null);
    void this.repositoryNodes
      .get(nodeId)
      .then((node) => {
        // A newer identity may have arrived while this was in flight — that load wins.
        if (this.hydratedFor === nodeId) this.node.set(node);
      })
      .catch(() => {
        // Allow a later attempt (e.g. after login) to retry this node.
        if (this.hydratedFor === nodeId) this.hydratedFor = null;
      });
  }

  /** Send a request under a fresh id and wait for its answer, bounded by `timeoutMs`. */
  private request(kind: DocumentRequestKind, timeoutMs: number): Promise<DocumentContent> {
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

      if (!this.send(kind, requestId)) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error(NO_HOST));
      }
    });
  }

  /**
   * Ask for the document — from the host page, or from the simulator while debug mode is on, whose answer takes the
   * same route back. False means there is nobody to ask.
   */
  private send(kind: DocumentRequestKind, requestId: string): boolean {
    if (this.debug.enabled()) return this.debug.answerDocumentRequest(kind, requestId);
    return kind === 'info'
      ? this.browserExtension.requestDocumentInfo(requestId)
      : this.browserExtension.requestDocumentContent(requestId);
  }
}
