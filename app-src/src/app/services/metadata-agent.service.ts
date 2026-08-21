import { Injectable, inject, signal } from '@angular/core';

import {
  BrowserExtensionService,
  PageSource,
  WORKER_UNREACHABLE,
  WORKER_UNREACHABLE_TEXT
} from './browser-extension.service';
import { DevModeService } from './dev-mode.service';
import { MetadataAgentApiService } from './metadata-agent-api.service';
import { SOURCE_TEXT_KEY } from '../util/agent-payload';
import { EXTRACT_FIELD_ANSWER } from '../util/dev-fixtures';
import { errorMessage } from '../util/errors';
import { CONTENT_TEXT_MAX } from '../util/page-context';
import { withoutQualityCriteria } from '../util/quality-criteria-values';

/** Reserved (non-metadata) top-level keys in the metadata-agent response. */
const ENVELOPE_KEYS = new Set([
  'contextName', 'schemaVersion', 'metadataset', 'metadataset_uri',
  'language', 'exportedAt', 'processing', 'preview_image_url', '_origins', '_source_text'
]);

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][agent]';

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
  private readonly agentApi = inject(MetadataAgentApiService);
  private readonly devMode = inject(DevModeService);

  private readonly lastRunState = signal<AnalyzeOutcome | null>(null);

  /** Last outcome, kept here so it survives view switches. */
  readonly lastRun = this.lastRunState.asReadonly();
  readonly running = signal(false);

  async run(): Promise<AnalyzeOutcome> {
    this.running.set(true);
    try {
      // The worker has no repository of its own to derive the agent from, so it is told which one
      // to call (see MetadataAgentApiService).
      const response = await this.browserExtension.analyzeActiveTab(
        LANGUAGE,
        this.agentApi.baseUrl(),
      );
      return this.remember(
        response.success
          ? {
              ok: true,
              source: response.source,
              // Stripped as the answer comes in, which is the only place a generated payload enters the
              // flow: everything downstream — the editors it seeds, the node the save writes, the
              // quality criteria's boxes — then reads a payload that answers no criterion.
              parsed: this.parse(withoutQualityCriteria(response.result ?? {}))
            }
          : { ok: false, error: this.describeError(response.error) },
      );
    } catch (cause: unknown) {
      return this.remember({ ok: false, error: errorMessage(cause) });
    } finally {
      this.running.set(false);
    }
  }

  /**
   * Run the agent on a page named by its address — for a content whose page is known but not open, so it is
   * erschlossen where it lives instead of wherever the browser happens to be. Same outcome as {@link run} and
   * stored as the same last run, since it is the same statement about the same kind of thing.
   */
  async runForUrl(url: string, title?: string | null): Promise<AnalyzeOutcome> {
    this.running.set(true);
    try {
      const response = await this.browserExtension.analyzeUrl(
        url,
        LANGUAGE,
        title,
        this.agentApi.baseUrl(),
      );
      return this.remember(
        response.success
          ? {
              ok: true,
              source: response.source,
              parsed: this.parse(withoutQualityCriteria(response.result ?? {}))
            }
          : { ok: false, error: this.describeError(response.error) },
      );
    } catch (cause: unknown) {
      return this.remember({ ok: false, error: errorMessage(cause) });
    } finally {
      this.running.set(false);
    }
  }

  /**
   * Generate one field from text the caller already holds and return its values. Deliberately not a full
   * {@link run}: the other fields would be paid for and thrown away. The outcome is not stored as
   * {@link lastRun}, so it neither opens in the metadata editor nor counts as unsaved work.
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

  /**
   * Split a flat metadata payload into envelope info + sorted display fields. The agent's own field
   * names are kept — this answer also feeds the WLO canvas, which is the agent's own form; renaming
   * them for the edu-sharing form is that form's business (`mapAgentFields`). Takes any flat payload —
   * a run's answer, a node's properties, the flow's accumulated values — so it drops nothing of its
   * own; what an agent answer may not state is stripped as it comes in (see {@link run}).
   */
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
    if (outcome.ok) this.reportTextLength(outcome.parsed?.raw ?? null);
    return outcome;
  }

  /**
   * How long the page's own text is, against how much of it the KI assistant is handed.
   *
   * Said here because this is where the text arrives and where it can still be acted on: a page far over the
   * bound is one the assistant will judge by an excerpt, and it says so per criterion in a way that reads as a
   * finding about the content rather than about the check. By the time the check runs, the run is paid for.
   *
   * The bound is the one the page context carries the text under ({@link CONTENT_TEXT_MAX}) — the tasks
   * themselves quote nothing, so that field is the whole of what reaches the model of the wording.
   */
  private reportTextLength(payload: Record<string, unknown> | null): void {
    const text = payload?.[SOURCE_TEXT_KEY];
    const length = typeof text === 'string' ? text.trim().length : 0;
    if (!length) {
      console.log(`${LOG} the run carries no page text — a KI check would have to fetch the page itself`);
      return;
    }
    console.log(
      `${LOG} the erschlossene page has ${length} characters; ${CONTENT_TEXT_MAX} of them are handed to the ` +
        `assistant${length > CONTENT_TEXT_MAX ? ` — ${length - CONTENT_TEXT_MAX} over the bound, so it is cut` : ''}`,
    );
  }

  private asCount(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
  }

  /**
   * POST the text to the agent's `/extract-field`, straight from the sidebar document — unlike {@link run}, which
   * goes through the background worker: the call then shows up in the panel's own DevTools and no second build
   * artifact can fall out of sync. `schema_file` and `field_id` are the only required parameters.
   */
  private async postExtractField(text: string, fieldId: string): Promise<ExtractFieldAnswer> {
    if (this.devMode.enabled()) {
      return this.devMode.answer(`Agent POST /extract-field (${fieldId})`, EXTRACT_FIELD_ANSWER);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.agentApi.baseUrl()}/extract-field`, {
        // The agent is the repository's own proxy, which authorizes by repository session — and a
        // cross-origin fetch sends no cookie unless it is asked to (see MetadataAgentApiService).
        credentials: 'include',
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
   * A single field's value as separate values. Beyond {@link flatten} it splits on commas as well: a multi-value
   * field's schema describes it as comma-separated, so the agent may answer with one joined string.
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
      // The message found no receiver at all, in none of its attempts — the panel's connection to the
      // worker did not come back after the page change it was rebuilt by.
      case WORKER_UNREACHABLE:
        return WORKER_UNREACHABLE_TEXT;
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
