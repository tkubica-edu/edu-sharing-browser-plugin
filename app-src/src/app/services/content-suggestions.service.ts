import { Injectable, computed, inject, signal } from '@angular/core';

import { errorMessage } from '../util/errors';
import { MetadataAgentService, ParsedMetadata } from './metadata-agent.service';
import { OnlyOfficeDocumentService } from './onlyoffice-document.service';

/** Agent fields the search words are taken from, in order of preference. */
const KEYWORD_FIELDS = ['cclom:general_keyword', 'cclom:classification_keyword'];

/** Fallback when the agent found no keywords — a title still searches for something sensible. */
const TITLE_FIELD = 'cclom:title';

/** More than a handful of words narrows the search to nothing. */
const MAX_KEYWORDS = 8;

const NO_KEYWORDS =
  'Für das Dokument konnten keine Schlagworte erzeugt werden. Bitte erst mehr Inhalte schreiben.';

/**
 * Derives search words from the document the host page has open, for "Passende Inhalte finden":
 * ask the OnlyOffice plugin for the document content, run the metadata agent on its markdown and
 * keep the keywords it generated. Those become the search word of `<edu-sharing-search>`.
 *
 * The run deliberately does **not** become the app's {@link MetadataAgentService.lastRun}: this is
 * a search aid, not an erschließen result, so it must not turn up in the metadata editor nor count
 * as unsaved work.
 */
@Injectable({ providedIn: 'root' })
export class ContentSuggestionsService {
  private readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);
  private readonly metadataAgent = inject(MetadataAgentService);

  readonly running = signal(false);
  readonly error = signal<string | null>(null);

  /** The keywords the agent generated for the open document. */
  readonly keywords = signal<readonly string[]>([]);

  /** The search word handed to `<edu-sharing-search>`; empty until keywords exist. */
  readonly searchString = computed(() => this.keywords().join(' '));

  /**
   * Read the open document, analyze it and keep its keywords. Returns true when a search word
   * could be derived; the failure message is in {@link error}.
   */
  async deriveFromOpenDocument(): Promise<boolean> {
    this.running.set(true);
    this.error.set(null);
    try {
      const content = await this.onlyOfficeDocument.requestContent();
      const outcome = await this.metadataAgent.analyzeText(content.markdown ?? '');
      if (!outcome.ok || !outcome.parsed) {
        this.error.set(outcome.error ?? NO_KEYWORDS);
        return false;
      }
      const keywords = this.pickKeywords(outcome.parsed);
      if (!keywords.length) {
        this.error.set(NO_KEYWORDS);
        return false;
      }
      this.keywords.set(keywords);
      return true;
    } catch (cause: unknown) {
      this.error.set(errorMessage(cause));
      return false;
    } finally {
      this.running.set(false);
    }
  }

  /** Forget the derived keywords, so the next visit reads the document again. */
  reset(): void {
    this.keywords.set([]);
    this.error.set(null);
  }

  /** The keyword fields' values, de-duplicated and capped; the title if there are none. */
  private pickKeywords(parsed: ParsedMetadata): string[] {
    const valuesOf = (keys: string[]) =>
      parsed.fields.filter((field) => keys.includes(field.key)).flatMap((field) => field.values);
    const candidates = valuesOf(KEYWORD_FIELDS);
    const words = candidates.length ? candidates : valuesOf([TITLE_FIELD]);
    const unique = new Map(
      words
        .map((word) => word.trim())
        .filter(Boolean)
        .map((word) => [word.toLowerCase(), word]),
    );
    return [...unique.values()].slice(0, MAX_KEYWORDS);
  }
}
