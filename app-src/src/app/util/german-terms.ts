// German term handling, shared by everything in the panel that reads a page's words: which words carry a
// signal at all, whether a term occurs in a text, and how a label is folded before it is compared to another.
//
// It lives here rather than beside its first caller because two very different things need it — ranking the
// keywords of a document (KeywordRankingService) and matching a page's terms against a metadata set's
// valuespace (util/vocabulary-match.ts) — and a util module must not import a service module for it.

/** Above this length a term may match anywhere in a word (see {@link termMatches}). */
const SHORT_TERM_MAX = 3;

/**
 * German stopwords, which must not act as a relevance signal. They are not merely useless but
 * actively harmful, because German stopwords sit inside ordinary words ("Stu-die-n", "Me-die-n") —
 * so a substring test would report a hit for a keyword that is only an article.
 */
export const DE_STOPWORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'einem', 'einen', 'eines',
  'und', 'oder', 'aber', 'als', 'auch', 'auf', 'aus', 'bei', 'bis', 'für', 'mit', 'nach',
  'von', 'vor', 'wie', 'über', 'unter', 'durch', 'gegen', 'ohne', 'zwischen',
  'ist', 'sind', 'war', 'hat', 'wird', 'kann', 'soll', 'zum', 'zur', 'vom',
  'nicht', 'noch', 'nur', 'sehr', 'schon', 'dann', 'wenn', 'dass', 'weil',
  'im', 'am', 'an', 'in', 'zu', 'so', 'es', 'ob',
]);

/** The words of a keyword that can carry a signal — long enough, and not a stopword. */
export function signalTerms(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 2 && !DE_STOPWORDS.has(term));
}

/**
 * Whether `term` occurs in `text` as a signal rather than by accident. A plain substring test is right for German,
 * where a term sits inside compounds and inflections; for a short term it is mostly accident. Position separates
 * them, so a short term must match at a word start — requiring the end too would reject those compounds.
 */
export function termMatches(term: string, text: string): boolean {
  if (!term || !text) return false;
  if (term.length > SHORT_TERM_MAX) return text.includes(term);
  for (let from = 0; ; from += 1) {
    const at = text.indexOf(term, from);
    if (at === -1) return false;
    if (at === 0 || !/[\p{L}\p{N}]/u.test(text[at - 1])) return true;
    from = at;
  }
}

/** Umlauts and the sharp s as their transcriptions, so a folded label compares equal either way spelled. */
export function foldUmlauts(value: string): string {
  return value
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

/**
 * A label in the one shape two labels can be compared in: lowercased, umlauts folded, everything that is
 * not a letter or a digit a single space, trimmed. Deliberately lossy in one direction only — it never
 * shortens a label, so two labels fold together exactly when they are the same words.
 */
export function normalizeLabel(value: string | null | undefined): string {
  return foldUmlauts((value ?? '').toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The same folding for a label that is compared against a URI's last segment (`…/educationalContext/schule`). */
export function normalizeSlug(value: string | null | undefined): string {
  return normalizeLabel(value).replace(/ /g, '_');
}

/** Whether two texts share at least `atLeast` signal words — how one text is checked to be about another. */
export function sharedTerms(a: string | null | undefined, b: string | null | undefined): string[] {
  const theirs = new Set(signalTerms(b ?? '').filter((term) => term.length >= 4));
  if (!theirs.size) return [];
  const shared = new Set<string>();
  for (const term of signalTerms(a ?? '')) {
    if (term.length >= 4 && theirs.has(term)) shared.add(term);
  }
  return [...shared];
}
