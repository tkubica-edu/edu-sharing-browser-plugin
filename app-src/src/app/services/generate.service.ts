import { Injectable, inject, signal } from '@angular/core';
import { ExtService, ExtractedSource } from './ext.service';

/** Reserved (non-metadata) top-level keys in the /generate response. */
const ENVELOPE_KEYS = new Set([
  'contextName', 'schemaVersion', 'metadataset', 'metadataset_uri',
  'language', 'exportedAt', 'processing', 'preview_image_url', '_origins', '_source_text'
]);

export interface MetadataField {
  key: string;
  values: string[];
}

export interface ParsedResult {
  fieldsExtracted: number | null;
  fieldsTotal: number | null;
  contextName?: string;
  language?: string;
  fields: MetadataField[];
  raw: any;
}

export interface RunOutcome {
  ok: boolean;
  source?: ExtractedSource;
  parsed?: ParsedResult;
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class GenerateService {
  private readonly ext = inject(ExtService);

  /** Last run outcome, kept here so it survives Erschließung view switches. */
  readonly last = signal<RunOutcome | null>(null);
  readonly running = signal(false);

  async run(language = 'de'): Promise<RunOutcome> {
    this.running.set(true);
    try {
      const resp = await this.ext.runAnalyze(language);
      const outcome: RunOutcome = resp.success
        ? { ok: true, source: resp.source, parsed: this.parse(resp.result) }
        : { ok: false, error: this.describe(resp.error) };
      this.last.set(outcome);
      return outcome;
    } catch (e: unknown) {
      const outcome: RunOutcome = { ok: false, error: String((e as Error)?.message || e) };
      this.last.set(outcome);
      return outcome;
    } finally {
      this.running.set(false);
    }
  }

  /** Split the flat response into envelope + metadata fields, flattening values. */
  parse(raw: any): ParsedResult {
    const fields: MetadataField[] = [];
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw)) {
        if (ENVELOPE_KEYS.has(key)) continue;
        const values = this.flatten(value);
        if (values.length > 0) fields.push({ key, values });
      }
    }
    fields.sort((a, b) => a.key.localeCompare(b.key));
    const processing = raw?.processing || {};
    return {
      fieldsExtracted: typeof processing.fields_extracted === 'number' ? processing.fields_extracted : null,
      fieldsTotal: typeof processing.fields_total === 'number' ? processing.fields_total : null,
      contextName: raw?.contextName,
      language: raw?.language,
      fields,
      raw
    };
  }

  /** Flatten a metadata value (array | scalar | object) into display strings. */
  private flatten(value: unknown): string[] {
    if (value === null || value === undefined || value === '') return [];
    if (Array.isArray(value)) return value.flatMap((v) => this.flatten(v));
    if (typeof value === 'object') {
      const o = value as Record<string, unknown>;
      const pick = o['uri'] ?? o['name'] ?? o['label'] ?? o['@value'] ?? o['value'];
      if (pick !== undefined && pick !== null) return this.flatten(pick);
      return [JSON.stringify(o)];
    }
    return [String(value)];
  }

  private describe(error?: string): string {
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
