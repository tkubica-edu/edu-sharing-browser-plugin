import { Injectable, inject, signal } from '@angular/core';

import { BrowserExtensionService, PageSource } from './browser-extension.service';
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

const TEXT_EMPTY =
  'Der Text enthält zu wenig Inhalt für eine Erschließung.';

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
}

/**
 * Runs the metadata agent (through the background worker, see BrowserExtensionService) and parses
 * its response for display.
 */
@Injectable({ providedIn: 'root' })
export class MetadataAgentService {
  private readonly browserExtension = inject(BrowserExtensionService);

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
   * Run the agent on text the caller already holds and return the outcome **without** storing it
   * as {@link lastRun} — for flows that only consume the agent's output (deriving search keywords,
   * see ContentSuggestionsService) instead of opening it for editing.
   */
  async analyzeText(text: string): Promise<AnalyzeOutcome> {
    const trimmed = text.trim();
    if (trimmed.length < MIN_DOCUMENT_LENGTH) return { ok: false, error: TEXT_EMPTY };
    const response = await this.browserExtension.analyzeText(trimmed, LANGUAGE);
    return response.success
      ? { ok: true, parsed: this.parse(response.result) }
      : { ok: false, error: this.describeError(response.error) };
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
