import { Injectable, computed, inject, signal } from '@angular/core';

import { errorMessage } from '../util/errors';
import { KeywordRankingService, RankedKeyword } from './keyword-ranking.service';
import { MetadataAgentService } from './metadata-agent.service';
import { OnlyOfficeDocumentService } from './onlyoffice-document.service';

/**
 * The keywords in both roles: the agent field that is generated and the MDS widget the search filters on.
 * The same id on purpose, so the agent's values land in that filter unchanged — free-text keywords go in
 * verbatim, unlike vocabulary widgets, which would need valuespace keys.
 */
const KEYWORD_WIDGET = 'cclom:general_keyword';

/**
 * How many of the agent's keywords are kept at all — the list the screen shows. The cut is made
 * *after* ranking, so it keeps the best ones rather than the first ones the agent named.
 */
const MAX_KEYWORDS = 8;

/**
 * How many keywords the search starts with. All values of one widget go into a single criterion, which the
 * repository's query template joins so that the result set narrows — a long list of invented keywords
 * matches nothing. Which ones those are is {@link KeywordRankingService}'s decision; {@link step} relaxes.
 */
const SEARCH_KEYWORDS = 2;

const NO_KEYWORDS =
  'Für das Dokument konnten keine Schlagworte erzeugt werden. Bitte erst mehr Inhalte schreiben.';

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][keywords]';

/**
 * Derives search words from the document the host page has open: the plugin hands over its content, the agent
 * generates the keyword field from it, and those become the keyword filter of the search element. Only that one
 * field, since a full run takes far longer. The run does not become the app's `lastRun` — a search aid is no result.
 */
@Injectable({ providedIn: 'root' })
export class ContentSuggestionsService {
  private readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);
  private readonly metadataAgent = inject(MetadataAgentService);
  private readonly ranking = inject(KeywordRankingService);

  readonly running = signal(false);
  readonly error = signal<string | null>(null);

  /** The keywords the agent generated for the open document, best-supported first. */
  readonly keywords = signal<readonly string[]>([]);

  /**
   * The ranking behind {@link keywords} — the evidence per keyword, for anything that wants to show
   * *why* a keyword is searched or not.
   */
  readonly ranked = signal<readonly RankedKeyword[]>([]);

  /**
   * The document text the current keywords were generated from. Kept because the ranking needs it
   * *after* the agent answered, and because re-reading the document would mean another round trip
   * to the plugin for text we already had in hand.
   */
  readonly documentText = signal('');

  /**
   * How far the search has been relaxed, because invented keywords are often carried by no node at all: 0 is
   * the first {@link SEARCH_KEYWORDS}, 1 the first one only, 2 no keyword filter. Only ever advances, so a
   * query cannot ping-pong between two steps.
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
   * The filters handed to the search element as its `initialValues`, keyed by MDS widget id; empty at the last
   * step. Not its `searchString`, which is AND-ed on top and only narrows further. A computed, so the object
   * identity changes only with the keywords or the step — the setter re-runs the query on every set.
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
      const text = content.markdown ?? '';
      const outcome = await this.metadataAgent.extractField(text, KEYWORD_WIDGET);
      if (!outcome.ok) {
        this.error.set(outcome.error ?? NO_KEYWORDS);
        return false;
      }
      const fromAgent = this.pickKeywords(outcome.values ?? []);
      console.log(
        `${LOG} ⬅ ${fromAgent.length} from the agent, its own order (${text.length} chars of text):`,
        [...fromAgent],
      );

      // Rank against the very text the keywords were generated from, then cut — so the ones that
      // survive and lead are the ones the document supports, not the ones the agent named first.
      const ranked = this.ranking.rank(fromAgent, text).slice(0, MAX_KEYWORDS);
      if (!ranked.length) {
        this.error.set(NO_KEYWORDS);
        return false;
      }
      this.documentText.set(text);
      this.ranked.set(ranked);
      this.keywords.set(ranked.map((entry) => entry.keyword));
      this.step.set(0);
      this.logRanking(ranked);
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
    this.ranked.set([]);
    this.documentText.set('');
    this.error.set(null);
    this.step.set(0);
  }

  /**
   * Report the ranking: the order that came out, and which of it the query uses. The evidence goes
   * out as a table, because that is the form the weights are judged from — why a keyword sits where
   * it does is only visible next to its neighbours' numbers.
   */
  private logRanking(ranked: readonly RankedKeyword[]): void {
    console.log(
      `${LOG} ➡ after ranking, searched:`,
      [...this.searchKeywords()],
      '| rest only shown:',
      ranked.slice(this.searchKeywords().length).map((entry) => entry.keyword),
    );
    console.table(
      ranked.map((entry) => ({
        keyword: entry.keyword,
        score: Number(entry.score.toFixed(3)),
        text: entry.textScore,
        occurrences: entry.occurrences,
        title: entry.inTitle,
        heading: entry.inHeading,
        allTerms: entry.allTermsPresent,
        agentRank: entry.agentRank,
      })),
    );
  }

  /**
   * The generated keywords, de-duplicated (first spelling wins). Not capped here — the cap belongs
   * after the ranking, or it would throw away keywords before anything looked at them.
   */
  private pickKeywords(values: readonly string[]): string[] {
    const unique = new Map(
      values
        .map((word) => word.trim())
        .filter(Boolean)
        .map((word) => [word.toLowerCase(), word]),
    );
    return [...unique.values()];
  }
}
