import { Injectable, inject, signal } from '@angular/core';

import { BrowserExtensionService, PageSource } from './browser-extension.service';
import { DocumentIdentity, OnlyOfficeDocumentService } from './onlyoffice-document.service';
import { errorMessage } from '../util/errors';

/** Reserved (non-metadata) top-level keys in the metadata-agent response. */
const ENVELOPE_KEYS = new Set([
  'contextName', 'schemaVersion', 'metadataset', 'metadataset_uri',
  'language', 'exportedAt', 'processing', 'preview_image_url', '_origins', '_source_text'
]);

/** Language the metadata agent generates for. */
const LANGUAGE = 'de';

/** Below this the agent has nothing to work with (matches the background worker's own guard). */
const MIN_DOCUMENT_LENGTH = 50;

const DOCUMENT_EMPTY =
  'Das OnlyOffice-Dokument enthält zu wenig Text für eine Erschließung. Bitte erst Inhalte schreiben.';

export interface MetadataField {
  key: string;
  values: string[];
}

/** The agent's response, split into display fields plus the raw payload. */
export interface ParsedMetadata {
  fieldsExtracted: number | null;
  fieldsTotal: number | null;
  fields: MetadataField[];
  raw: Record<string, unknown>;
}

export interface AnalyzeOutcome {
  ok: boolean;
  source?: PageSource;
  parsed?: ParsedMetadata;
  error?: string;
  /**
   * Identity of the enriched document — set only by {@link MetadataAgentService.runForOpenDocument}.
   * It is the repository node the metadata belongs to, so the flow saves onto it instead of
   * creating a new one.
   */
  document?: DocumentIdentity | null;
}

/**
 * Runs the metadata agent against the active tab or against the document the host page has open
 * (through the background worker, see BrowserExtensionService) and parses its response for
 * display.
 */
@Injectable({ providedIn: 'root' })
export class MetadataAgentService {
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);

  private readonly lastRunState = signal<AnalyzeOutcome | null>(null);

  /** Last outcome, kept here so it survives view switches. */
  readonly lastRun = this.lastRunState.asReadonly();
  readonly running = signal(false);

  async run(): Promise<AnalyzeOutcome> {
    this.running.set(true);
    try {
      const response = await this.browserExtension.analyzeActiveTab(LANGUAGE);
      return this.remember(
        response.success
          ? { ok: true, source: response.source, parsed: this.parse(response.result) }
          : { ok: false, error: this.describeError(response.error) },
      );
    } catch (cause: unknown) {
      return this.remember({ ok: false, error: errorMessage(cause) });
    } finally {
      this.running.set(false);
    }
  }

  /**
   * Same as {@link run}, but the content comes from the document the host page has open (the
   * OnlyOffice editor) instead of the page: ask the plugin for the document content and send its
   * **markdown** rendering to the agent. The title/permalink of the document's repository node
   * become the source line, so the metadata screen shows what was enriched, and its identity is
   * returned in the outcome — the metadata belongs to that node, so the caller saves onto it.
   */
  async runForOpenDocument(): Promise<AnalyzeOutcome> {
    this.running.set(true);
    try {
      const content = await this.onlyOfficeDocument.requestContent();
      const markdown = content.markdown?.trim() ?? '';
      if (markdown.length < MIN_DOCUMENT_LENGTH) {
        return this.remember({ ok: false, error: DOCUMENT_EMPTY });
      }
      const response = await this.browserExtension.analyzeText(markdown, LANGUAGE);
      const document = content.document;
      return this.remember(
        response.success
          ? {
              ok: true,
              source: {
                url: this.onlyOfficeDocument.documentPermaLink() ?? '',
                title:
                  content.title || this.onlyOfficeDocument.documentTitle() || 'OnlyOffice-Dokument'
              },
              parsed: this.parse(response.result),
              document
            }
          : { ok: false, error: this.describeError(response.error) },
      );
    } catch (cause: unknown) {
      return this.remember({ ok: false, error: errorMessage(cause) });
    } finally {
      this.running.set(false);
    }
  }

  /** Split a flat metadata payload into envelope info + sorted display fields. */
  parse(raw: Record<string, unknown> | undefined): ParsedMetadata {
    const payload = raw ?? {};
    const fields = Object.entries(payload)
      .filter(([key]) => !ENVELOPE_KEYS.has(key))
      .map(([key, value]) => ({ key, values: this.flatten(value) }))
      .filter((field) => field.values.length > 0)
      .sort((a, b) => a.key.localeCompare(b.key));
    const processing = (payload['processing'] ?? {}) as Record<string, unknown>;
    return {
      fieldsExtracted: this.asCount(processing['fields_extracted']),
      fieldsTotal: this.asCount(processing['fields_total']),
      fields,
      raw: payload
    };
  }

  /** Reset the stored outcome (a fresh start discards the previous run). */
  reset(): void {
    this.lastRunState.set(null);
  }

  /** Restore a stored outcome, e.g. when reopening a history entry. */
  restore(outcome: AnalyzeOutcome | null): void {
    this.lastRunState.set(outcome);
  }

  private remember(outcome: AnalyzeOutcome): AnalyzeOutcome {
    this.lastRunState.set(outcome);
    return outcome;
  }

  private asCount(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
  }

  /** Flatten a metadata value (array | scalar | object) into display strings. */
  private flatten(value: unknown): string[] {
    if (value === null || value === undefined || value === '') return [];
    if (Array.isArray(value)) return value.flatMap((entry) => this.flatten(entry));
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const labelled =
        record['uri'] ?? record['name'] ?? record['label'] ?? record['@value'] ?? record['value'];
      return labelled === undefined || labelled === null
        ? [JSON.stringify(record)]
        : this.flatten(labelled);
    }
    return [String(value)];
  }

  private describeError(error?: string): string {
    switch (error) {
      case 'UNSUPPORTED_PAGE':
        return 'Diese Seite kann nicht erschlossen werden (interne Browser-Seite). Bitte eine normale Webseite öffnen.';
      case 'NO_ACTIVE_TAB':
        return 'Kein aktiver Tab gefunden.';
      case 'EMPTY_EXTRACTION':
      case 'EXTRACTION_FAILED':
        return 'Der Seiteninhalt konnte nicht ausgelesen werden.';
      default:
        return error ? `Fehler: ${error}` : 'Unbekannter Fehler bei der Erschließung.';
    }
  }
}
