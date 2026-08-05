import { Injectable, inject, signal } from '@angular/core';

import { APP_CONFIG } from '../config';
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

/**
 * Schema the single-field extraction resolves its field from. `core.json` holds the core fields
 * (title, description, keywords …); a content-type-specific field would need that type's schema.
 */
const CORE_SCHEMA = 'core.json';

/** Same bound the background worker puts on a `/generate` (`network.generateTimeoutMs`). */
const EXTRACT_TIMEOUT_MS = 60000;

const TEXT_EMPTY =
  'Der Text enthält zu wenig Inhalt für eine Erschließung.';

const EXTRACT_TIMEOUT = 'Der Metadaten-Agent hat nicht rechtzeitig geantwortet.';

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

/** Outcome of a single-field generation (see {@link MetadataAgentService.extractField}). */
export interface FieldOutcome {
  ok: boolean;
  values?: string[];
  error?: string;
}

/** The agent's `/extract-field` answer — one field, so a `value` instead of a field map. */
interface ExtractFieldAnswer {
  field_id?: string;
  field_label?: string | null;
  value?: unknown;
  /** The value before normalization; null whenever normalization changed nothing. */
  raw_value?: unknown;
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
   * Generate **one** field from text the caller already holds (`/extract-field`) and return its
   * values. Deliberately not a full {@link run}: a flow that only consumes a single value has no
   * use for the other fields and should not pay for their extraction — and the outcome is not
   * stored as {@link lastRun}, so it neither opens in the metadata editor nor counts as unsaved
   * work (deriving search keywords, see ContentSuggestionsService).
   */
  async extractField(text: string, fieldId: string): Promise<FieldOutcome> {
    const trimmed = text.trim();
    if (trimmed.length < MIN_DOCUMENT_LENGTH) return { ok: false, error: TEXT_EMPTY };
    try {
      const answer = await this.postExtractField(trimmed, fieldId);
      return { ok: true, values: this.splitValues(answer.value ?? answer.raw_value) };
    } catch (cause: unknown) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        return { ok: false, error: EXTRACT_TIMEOUT };
      }
      return { ok: false, error: this.describeError(errorMessage(cause)) };
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

  /**
   * POST the text to the agent's `/extract-field`, straight from the sidebar document — the same
   * way the WLO canvas calls `/generate` (`window.__ENV.agentUrl`, also {@link APP_CONFIG.apiUrl}),
   * and unlike {@link run}, which goes through the background worker.
   *
   * Deliberately so: the call shows up in the panel's own DevTools like every other request the
   * sidebar makes, and there is no second build artifact that can fall out of sync — a worker still
   * running an older script silently drops messages it does not know. The extension's
   * `host_permissions` are what let this document reach a foreign origin at all.
   *
   * `schema_file` and `field_id` are the endpoint's only required parameters; the field definition
   * (and its prompt) is resolved from that schema.
   */
  private async postExtractField(text: string, fieldId: string): Promise<ExtractFieldAnswer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
    try {
      const response = await fetch(`${APP_CONFIG.apiUrl}/extract-field`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          input_source: 'text',
          text,
          schema_file: CORE_SCHEMA,
          field_id: fieldId,
          context: 'default',
          version: 'latest',
          language: LANGUAGE,
          normalize: true
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).substring(0, 300);
        throw new Error(`extract-field failed: ${response.status} - ${detail}`);
      }
      const answer = (await response.json().catch(() => null)) as ExtractFieldAnswer | null;
      if (!answer || typeof answer !== 'object') {
        throw new Error('extract-field: invalid API response');
      }
      return answer;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * A single field's value as a list of separate values. Beyond {@link flatten} it also splits on
   * commas: a multi-value field's schema describes it as comma-separated (`cclom:general_keyword`
   * is "Schlagwörter (kommagetrennt)") and its examples allow either form, so the agent may answer
   * with one joined string instead of an array.
   */
  private splitValues(value: unknown): string[] {
    return this.flatten(value)
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter(Boolean);
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
      // The worker did not answer at all. Its router ignores actions outside its allow-list, so
      // this is what a sidebar and a background script from different builds look like: reloading
      // the page picks up a new sidebar from disk, but the registered worker keeps running the old
      // script until the extension itself is reloaded.
      case 'NO_RESPONSE':
        return 'Der Hintergrunddienst der Extension hat nicht geantwortet. Bitte die Extension neu laden (nicht nur die Seite neu laden).';
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
