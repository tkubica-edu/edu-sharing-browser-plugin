import { Injectable, computed, inject, signal } from '@angular/core';

import { errorMessage } from '../util/errors';
import { MetadataAgentService, ParsedMetadata } from './metadata-agent.service';
import { OnlyOfficeDocumentService } from './onlyoffice-document.service';

/** Agent fields the search words are taken from, in order of preference. */
const KEYWORD_FIELDS = ['cclom:general_keyword', 'cclom:classification_keyword'];

/**
 * The MDS widget the keywords are filtered on. `cclom:general_keyword` is a free-text keyword in
 * the search index, so the agent's values go in verbatim — unlike vocabulary widgets (e.g.
 * `ccm:educationalcontext`), which would need valuespace keys instead of labels.
 */
const KEYWORD_WIDGET = 'cclom:general_keyword';

/** Fallback when the agent found no keywords — a title still searches for something sensible. */
const TITLE_FIELD = 'cclom:title';

/** How many of the agent's keywords are kept at all — the list the screen shows. */
const MAX_KEYWORDS = 8;

/**
 * How many keywords the search *starts* with. All values of one widget go into a single search
 * criterion, and the repository's `ngsearch` query template joins them in a way that narrows the
 * result set — so a long list of agent-invented keywords matches nothing at all, while the first
 * (most relevant) two still find promising content. See {@link step} for the relaxation from here.
 */
const SEARCH_KEYWORDS = 2;

const NO_KEYWORDS =
  'Für das Dokument konnten keine Schlagworte erzeugt werden. Bitte erst mehr Inhalte schreiben.';

/**
 * Derives search words from the document the host page has open, for "Passende Inhalte finden":
 * ask the OnlyOffice plugin for the document content, run the metadata agent on its markdown and
 * keep the keywords it generated. Those become the keyword filter of `<edu-sharing-search>`.
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

  /**
   * How far the search has been relaxed, because keywords the agent invented are often carried by
   * no node at all: `0` = the first {@link SEARCH_KEYWORDS} keywords, `1` = the first one only,
   * `2` = no keyword filter. Only ever advances (see {@link relax}), so a query can never
   * ping-pong between two steps.
   */
  private readonly step = signal(0);

  /** The keywords the current step actually searches for — the rest are only shown. */
  readonly searchKeywords = computed<readonly string[]>(() => {
    const counts = [SEARCH_KEYWORDS, 1, 0];
    return this.keywords().slice(0, counts[this.step()]);
  });

  /** True once the search runs without any keyword filter — nothing is left to widen. */
  readonly unfiltered = computed(() => this.step() === 2);

  /**
   * The filters handed to `<edu-sharing-search>` as its `initialValues`: the searched keywords as
   * values of the keyword widget, keyed by MDS widget id. Empty at the last step.
   *
   * Deliberately not the element's `searchString`: that goes in as an extra `ngsearchword`
   * criterion which is AND-ed with the filters, so it only narrows further — while as filter values
   * the keywords are matched against the indexed keywords of the nodes, which is what they are for.
   *
   * A `computed`, so the object identity only changes when the keywords or the step do: the
   * element's `initialValues` setter rebuilds its whole filter editor and re-runs the query on
   * every set, so handing it a fresh object per change detection would search in a loop.
   */
  readonly filters = computed<Record<string, string[]>>(() => {
    const keywords = this.searchKeywords();
    const filters: Record<string, string[]> = {};
    if (keywords.length) filters[KEYWORD_WIDGET] = [...keywords];
    return filters;
  });

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
      this.step.set(0);
      return true;
    } catch (cause: unknown) {
      this.error.set(errorMessage(cause));
      return false;
    } finally {
      this.running.set(false);
    }
  }

  /**
   * Widen the search by one step, after it found nothing. Returns whether it moved: the automatic
   * ladder ends at a single keyword — dropping the filter entirely is the user's call
   * ({@link searchWithoutKeywords}), because it shows the whole repository.
   */
  relax(): boolean {
    if (this.step() !== 0) return false;
    this.step.set(1);
    return true;
  }

  /** Search without any keyword filter, so at least the repository's content is browsable. */
  searchWithoutKeywords(): void {
    this.step.set(2);
  }

  /** Forget the derived keywords, so the next visit reads the document again. */
  reset(): void {
    this.keywords.set([]);
    this.error.set(null);
    this.step.set(0);
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
