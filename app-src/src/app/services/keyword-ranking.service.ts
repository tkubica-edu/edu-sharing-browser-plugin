import { Injectable } from '@angular/core';

/**
 * Ranks the keywords the metadata agent generated against the document they were generated from,
 * so the search starts with the ones that actually carry the document's subject.
 *
 * Why rank at all: only the first few keywords are searched (all values of one widget land in a
 * single criterion whose join narrows the result set — see ContentSuggestionsService), so *which*
 * ones come first decides whether anything is found. The agent returns 3–8 keywords in its own
 * order, and that order is a guess made without knowing which of them the document really leans
 * on: a term that appears in the heading and five times in the body describes the document better
 * than one the agent inferred and never wrote down.
 *
 * Scoring follows the shape of the WLO reranker (`wlo-mcp-sc/src/reranker.ts`): additive points
 * per signal, then a normalized blend in which the text evidence dominates and the agent's own
 * order only nudges the result — so consensus can break ties but never outvote what the document
 * says. Everything is local and synchronous; no second agent call is involved.
 */

/** Above this length a term may match anywhere in a word (see {@link termMatches}). */
const SHORT_TERM_MAX = 3;

/**
 * German stopwords, which must not act as a relevance signal. They are not merely useless but
 * actively harmful, because German stopwords sit inside ordinary words ("Stu-die-n", "Me-die-n") —
 * so a substring test would report a hit for a keyword that is only an article.
 */
const DE_STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen', 'eines',
  'und', 'oder', 'aber', 'als', 'auch', 'auf', 'aus', 'bei', 'bis', 'für', 'mit', 'nach',
  'von', 'vor', 'wie', 'über', 'unter', 'durch', 'gegen', 'ohne', 'zwischen',
  'ist', 'sind', 'war', 'hat', 'wird', 'kann', 'soll', 'zum', 'zur', 'vom',
  'nicht', 'noch', 'nur', 'sehr', 'schon', 'dann', 'wenn', 'dass', 'weil',
  'im', 'am', 'an', 'in', 'zu', 'so', 'es', 'ob',
]);

// ── Point weights ────────────────────────────────────────────────────────────
// Where a keyword occurs matters more than how often: a heading names the subject, the body merely
// mentions it. The absent penalty is the largest single number, because a keyword the document
// never uses is the one case where the agent's suggestion has no support at all.

/** The whole keyword occurs in the document's own title (its first heading). */
const TITLE_HIT = 30;
/** The whole keyword occurs in any heading. */
const HEADING_HIT = 12;
/** The whole keyword occurs in the body. */
const PHRASE_HIT = 10;
/** One word of a multi-word keyword occurs. */
const TERM_HIT = 5;
/** …and a bonus when *every* word of it does — the phrase is present, just not verbatim. */
const ALL_TERMS_HIT = 8;
/** Per repeat beyond the first occurrence. */
const REPEAT_HIT = 2;
/** How many repeats count at all — beyond this, more mentions say nothing new. */
const REPEAT_CAP = 3;
/** Awarded proportionally the closer the first occurrence sits to the top of the document. */
const EARLY_MAX = 6;
/** The keyword occurs nowhere: the agent inferred it rather than reading it. */
const ABSENT_PENALTY = 20;
/**
 * Per word beyond the second. A long phrase describes the document well but is not what the
 * repository's `cclom:general_keyword` index carries — nodes are tagged with terms, not sentences —
 * so as a *search* word it is the weaker choice even when the document supports it.
 */
const WORD_PENALTY = 4;
/** Beyond this many words a keyword is a phrase, not a search term (penalty stops growing). */
const WORDS_UNPENALIZED = 2;

// ── Final blend ──────────────────────────────────────────────────────────────
// The document's evidence dominates; the agent's order nudges the result; occurring in several
// places at once earns a small bonus capped below either weight.

const TEXT_WEIGHT = 0.8;
const AGENT_WEIGHT = 0.1;
const SPREAD_BONUS_MAX = 0.1;

/** The places a keyword can occur in — the denominator of the spread bonus. */
const PLACES = 3;

/** One keyword with the evidence behind its position. */
export interface RankedKeyword {
  keyword: string;
  /** Blended 0…1 score the order is by. */
  score: number;
  /** Raw additive points from the document (may be 0 after the absent penalty). */
  textScore: number;
  /** How often the whole keyword occurs in the document. */
  occurrences: number;
  inTitle: boolean;
  inHeading: boolean;
  /** Every word of the keyword occurs somewhere, even if the phrase does not. */
  allTermsPresent: boolean;
  /** Position in the agent's own answer (0 = first). */
  agentRank: number;
}

@Injectable({ providedIn: 'root' })
export class KeywordRankingService {
  /**
   * Order `keywords` by how well the document supports each, best first.
   *
   * Nothing is dropped: the screen shows every keyword the agent produced and marks which of them
   * the query uses, so ranking decides the *order* — and the caller's cut-off decides the rest.
   *
   * Without usable text (no document read, or a document too short to say anything) the agent's
   * order is kept as-is rather than replaced by an arbitrary one.
   */
  rank(keywords: readonly string[], text: string): RankedKeyword[] {
    const document = this.prepare(text);
    const scored = keywords.map((keyword, agentRank) => this.score(keyword, agentRank, document));
    if (!document.body) return scored;

    const maxText = Math.max(...scored.map((entry) => entry.textScore), 1);
    // The agent's order as a descending signal: first place scores 1, last place ~0.
    const lastRank = Math.max(keywords.length - 1, 1);
    for (const entry of scored) {
      const places =
        (entry.inTitle ? 1 : 0) + (entry.inHeading ? 1 : 0) + (entry.occurrences > 0 ? 1 : 0);
      entry.score =
        (entry.textScore / maxText) * TEXT_WEIGHT +
        (1 - entry.agentRank / lastRank) * AGENT_WEIGHT +
        (places / PLACES) * SPREAD_BONUS_MAX;
    }

    // Deterministic tie-breaker: equal scores keep the agent's order, and identical positions there
    // (impossible today, but the sort must not depend on engine stability) fall back to the word.
    return scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.agentRank !== b.agentRank) return a.agentRank - b.agentRank;
      return a.keyword.localeCompare(b.keyword, 'de');
    });
  }

  /** Additive points for one keyword — the raw evidence, before normalization. */
  private score(keyword: string, agentRank: number, document: PreparedDocument): RankedKeyword {
    const phrase = keyword.trim().toLowerCase();
    const entry: RankedKeyword = {
      keyword,
      score: 0,
      textScore: 0,
      occurrences: 0,
      inTitle: false,
      inHeading: false,
      allTermsPresent: false,
      agentRank,
    };
    if (!phrase || !document.body) return entry;

    entry.occurrences = this.countMatches(phrase, document.body);
    entry.inTitle = termMatches(phrase, document.title);
    entry.inHeading = termMatches(phrase, document.headings);

    let score = 0;
    if (entry.inTitle) score += TITLE_HIT;
    if (entry.inHeading) score += HEADING_HIT;

    if (entry.occurrences > 0) {
      score += PHRASE_HIT + Math.min(entry.occurrences - 1, REPEAT_CAP) * REPEAT_HIT;
      // How far into the document the first mention sits. A document is written from its subject
      // outwards, so an early mention is about the whole of it and a late one about a detail.
      const at = document.body.indexOf(phrase);
      score += Math.round((1 - at / document.body.length) * EARLY_MAX);
    } else {
      // The phrase itself is missing — check whether its words are there. "Addieren von Brüchen"
      // is a keyword no document writes verbatim, yet both its terms carry it.
      const terms = signalTerms(phrase);
      const present = terms.filter((term) => termMatches(term, document.body));
      score += present.length * TERM_HIT;
      entry.allTermsPresent = terms.length > 0 && present.length === terms.length;
      if (terms.length > 1 && entry.allTermsPresent) score += ALL_TERMS_HIT;
      if (present.length === 0) score -= ABSENT_PENALTY;
    }

    // Longer phrases are worse search words regardless of how well the document supports them.
    const words = signalTerms(phrase).length;
    if (words > WORDS_UNPENALIZED) score -= (words - WORDS_UNPENALIZED) * WORD_PENALTY;

    entry.textScore = Math.max(score, 0);
    return entry;
  }

  /** Non-overlapping occurrences of `phrase` in `text` (both lowercase). */
  private countMatches(phrase: string, text: string): number {
    let count = 0;
    for (let from = 0; ; from += phrase.length) {
      const at = text.indexOf(phrase, from);
      if (at === -1) return count;
      count++;
      from = at;
    }
  }

  /**
   * Split the document into the parts that weigh differently. The title is its first heading —
   * markdown from an OnlyOffice document starts with it, and it is the one line that names what the
   * whole document is about.
   */
  private prepare(text: string): PreparedDocument {
    const body = (text ?? '').toLowerCase();
    const headings = [...body.matchAll(/^#{1,6}[ \t]+(.*)$/gm)].map((match) => match[1].trim());
    return { body, title: headings[0] ?? '', headings: headings.join('\n') };
  }
}

interface PreparedDocument {
  /** The whole document, lowercased. */
  body: string;
  /** Its first heading. */
  title: string;
  /** All headings, one per line. */
  headings: string;
}

/** The words of a keyword that can carry a signal — long enough, and not a stopword. */
function signalTerms(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2 && !DE_STOPWORDS.has(term));
}

/**
 * Does `term` occur in `text` as a signal rather than by accident?
 *
 * A plain substring test is right for German: "Rechnung" belongs inside "Bruchrechnung" and
 * "Mittelalter" inside "mittelalterlichen". For a SHORT term the same test is mostly accident —
 * "IT" sits inside "Pol-it-ik" and "Maur-it-ius". What separates the two is where the match sits:
 * a compound or an inflection carries the term at a word START, while accidental ones bury it
 * mid-word. So a short term must match at a word boundary, a longer one keeps the substring
 * behaviour German needs. Only the start is checked — requiring one at the end too would reject
 * exactly those compounds.
 */
function termMatches(term: string, text: string): boolean {
  if (!term || !text) return false;
  if (term.length > SHORT_TERM_MAX) return text.includes(term);
  for (let from = 0; ; from += 1) {
    const at = text.indexOf(term, from);
    if (at === -1) return false;
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1])) return true;
    from = at;
  }
}
