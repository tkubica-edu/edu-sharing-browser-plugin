import { Injectable, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
import {
  DocumentContent,
  DocumentRequestKind,
  PLUGIN_SOURCE,
  PluginEnvelope,
} from '../model/onlyoffice-events';
import { BrowserExtensionService } from './browser-extension.service';

/**
 * Node id the simulated document reports as the edited one. A deliberately fake default: the
 * repository load then fails silently and the app falls back to the bare id. Put a real node id
 * of the configured repository in the settings to let the whole flow run through, including
 * saving the enriched metadata onto that node.
 */
const DEFAULT_DOCUMENT_NODE_ID = 'debug-document-node';

/** Title the simulated editor reports for its document. */
const DOCUMENT_TITLE = 'Debug-Testdokument.docx';

/**
 * The simulated document's text. Long and topical on purpose: the metadata agent needs at least
 * 50 characters (see MetadataAgentService) and only produces meaningful fields for content that
 * actually looks like teaching material.
 */
const DOCUMENT_MARKDOWN = `# Photosynthese im Biologieunterricht

## Lernziele
Die Schülerinnen und Schüler können den Ablauf der Photosynthese in Grundzügen beschreiben,
die Rolle von Chlorophyll und Sonnenlicht erklären und die Wortgleichung der Photosynthese
aufstellen.

## Fachlicher Hintergrund
Bei der Photosynthese wandeln grüne Pflanzen, Algen und einige Bakterien Lichtenergie in
chemisch gebundene Energie um. Aus Kohlendioxid und Wasser entstehen Glucose und Sauerstoff.
Der Prozess läuft in den Chloroplasten ab und gliedert sich in die lichtabhängigen Reaktionen
an den Thylakoidmembranen und den lichtunabhängigen Calvin-Zyklus im Stroma.

## Unterrichtsverlauf
1. Einstieg: Beobachtung einer Wasserpflanze unter der Lampe (Sauerstoffbläschen).
2. Erarbeitung: Gruppenarbeit an Modellen der Chloroplasten.
3. Sicherung: Die Wortgleichung wird gemeinsam an der Tafel entwickelt.

## Zielgruppe
Sekundarstufe I, Jahrgangsstufe 7 bis 9, Fach Biologie. Bearbeitungsdauer etwa 90 Minuten.
Das Material steht unter der Lizenz CC BY-SA 4.0 und darf frei weiterverwendet werden.`;

/** Plain-text rendering of the same document, as the plugin would deliver it. */
const DOCUMENT_TEXT = DOCUMENT_MARKDOWN.replace(/^#+ /gm, '');

/**
 * Delay before a simulated answer arrives. Small but non-zero, so callers see the same
 * asynchronous behaviour (spinners, in-flight guards) as with the real plugin.
 */
const SIMULATED_LATENCY_MS = 250;

/** Log prefix, matching the one used by content/panel-host.js. */
const LOG = '[edu-sharing][debug]';

/**
 * Development mode that stands in for the host-side OnlyOffice plugin: every page counts as an
 * insert host (see ConditionsService) and each `REQUEST_DOCUMENT_*` is answered right away with the
 * fixtures above, instead of being broadcast to a host page that would never reply.
 *
 * The answers are **fed in through the real inbound path** — a window message carrying the plugin's
 * own {@link PLUGIN_SOURCE} marker, which `AppComponent` routes to
 * `OnlyOfficeDocumentService.accept()`. So the `requestId` correlation, the identity handling and
 * the node hydration run exactly as in production; nothing downstream knows it is a fixture.
 */
@Injectable({ providedIn: 'root' })
export class DebugService {
  private readonly browserExtension = inject(BrowserExtensionService);

  private readonly enabledState = signal(false);
  private readonly documentNodeIdState = signal(DEFAULT_DOCUMENT_NODE_ID);

  /** True while the OnlyOffice events are simulated. Persisted, so it survives a reload. */
  readonly enabled = this.enabledState.asReadonly();

  /** Node id the simulated document reports (editable in the settings). */
  readonly documentNodeId = this.documentNodeIdState.asReadonly();

  /**
   * Load the persisted debug settings. Must run **before** anything reads
   * `ConditionsService.onlyOfficePresent()` (the boot's document request, the option
   * visibility), because the flag decides that condition.
   */
  async load(): Promise<void> {
    const { debugMode, debugDocumentNodeId } = APP_CONFIG.storageKeys;
    this.enabledState.set(await this.browserExtension.storageGet(debugMode, false));
    this.documentNodeIdState.set(
      await this.browserExtension.storageGet(debugDocumentNodeId, DEFAULT_DOCUMENT_NODE_ID),
    );
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabledState.set(enabled);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.debugMode, enabled);
  }

  /** An empty id falls back to the default, so the field can never be left unusable. */
  async setDocumentNodeId(nodeId: string): Promise<void> {
    const id = nodeId.trim() || DEFAULT_DOCUMENT_NODE_ID;
    this.documentNodeIdState.set(id);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.debugDocumentNodeId, id);
  }

  /**
   * Answer a document request with fixtures instead of asking the host page. Returns true like
   * the real send, so the caller's "no host page" branch stays untouched.
   */
  answerDocumentRequest(kind: DocumentRequestKind, requestId: string): boolean {
    const document = { nodeId: this.documentNodeIdState() };
    const data: DocumentContent =
      kind === 'info'
        ? { trigger: 'request', requestId, editorType: 'word', document }
        : {
            trigger: 'request',
            requestId,
            editorType: 'word',
            title: DOCUMENT_TITLE,
            text: DOCUMENT_TEXT,
            markdown: DOCUMENT_MARKDOWN,
            document,
          };
    this.emit({
      event: kind === 'info' ? 'DOCUMENT_INFO' : 'DOCUMENT_CONTENT',
      data,
      document,
    });
    return true;
  }

  /**
   * Fire a `PREVIEW_NODE` for the configured test node — the one host event nothing requests, so
   * it needs a manual trigger (the settings' debug section). Only the id is read by the app; the
   * remaining fields are sent to match the real envelope.
   */
  emitPreviewNode(): void {
    const nodeId = this.documentNodeIdState();
    this.emit({
      event: 'PREVIEW_NODE',
      data: {
        id: nodeId,
        nodeTitle: DOCUMENT_TITLE,
        nodeMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      document: { nodeId },
    });
  }

  /**
   * Post the envelope to our own window, where `AppComponent`'s single `window:message` listener
   * picks it up — the same route a relayed plugin message takes. Delayed, so a caller that
   * registers its pending request synchronously after sending is never surprised by an answer
   * that arrived first.
   */
  private emit(envelope: PluginEnvelope): void {
    const message = { source: PLUGIN_SOURCE, ...envelope };
    setTimeout(() => {
      console.log(`${LOG} ⬅ simulated plugin event:`, message.event, message);
      window.postMessage(message, '*');
    }, SIMULATED_LATENCY_MS);
  }
}
