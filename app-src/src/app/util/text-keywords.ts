// Keyword candidates out of a page's own text, for a content whose page states none of its own.
//
// This is term frequency, not aboutness: it finds the words the text keeps using, which is a weaker
// statement than a keyword the author chose. That is why what comes out of here is offered as a proposal
// and never written as a value, and why the bar is deliberately high — a word has to occur twice, or once
// in a heading, to be a candidate at all.
//
// German nouns are the target, and their capitalisation is the one signal that separates them from the
// rest of a sentence without a dictionary. It is also why this would be poor for English text: there, the
// same rule finds sentence beginnings and proper names.

import { DE_STOPWORDS, normalizeLabel } from './german-terms';

/** Shorter than this a word carries too little to be a keyword of its own. */
const TERM_MIN_LENGTH = 4;

/** How often a word has to occur to count, unless it stands in a heading. */
const OCCURRENCES_MIN = 2;

/** How many candidates are offered at most — beyond a handful they stop being keywords. */
const CANDIDATES_MAX = 5;

/** A capitalised word, as German writes a noun. Hyphenated compounds count as one word. */
const NOUN = /\p{Lu}[\p{L}]+(?:-\p{Lu}?[\p{L}]+)*/gu;

/**
 * The words the text is built on, most-used first. Deterministic throughout — occurrences, then first
 * position, then the German collation — so the same page always proposes the same words and a diff of two
 * runs says something.
 *
 * `headings` weigh as a whole occurrence each: a word in a heading names what follows it.
 */
export function candidateKeywords(
  text: string | null | undefined,
  headings: readonly string[] = [],
  limit = CANDIDATES_MAX,
): string[] {
  const body = (text ?? '').trim();
  if (!body) return [];
  const counted = new Map<string, { word: string; count: number; at: number; heading: boolean }>();
  const count = (source: string, heading: boolean): void => {
    for (const match of source.matchAll(NOUN)) {
      const word = match[0];
      if (word.length < TERM_MIN_LENGTH) continue;
      const folded = normalizeLabel(word);
      if (!folded || DE_STOPWORDS.has(word.toLowerCase())) continue;
      const held = counted.get(folded);
      if (held) {
        held.count += 1;
        held.heading = held.heading || heading;
      } else {
        counted.set(folded, { word, count: 1, at: match.index ?? 0, heading });
      }
    }
  };
  for (const heading of headings) count(heading, true);
  count(body, false);
  return [...counted.values()]
    .filter((entry) => entry.heading || entry.count >= OCCURRENCES_MIN)
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.at - b.at ||
        a.word.localeCompare(b.word, 'de'),
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.word);
}

/**
 * The text as the keyword ranker reads it. `KeywordRankingService` was written for a markdown document and
 * finds a document's title and headings by their `#` markers; a page's text has none, so its two strongest
 * signals would be silently absent. Writing the headings back as markdown lines is what makes the ranker
 * see them — cheaper and less risky than teaching it a second document shape.
 */
export function rankingTextOf(headings: readonly string[], body: string | null | undefined): string {
  const marked = headings
    .map((heading) => heading.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((heading, index) => `${index === 0 ? '#' : '##'} ${heading}`);
  return [...marked, (body ?? '').trim()].filter(Boolean).join('\n\n');
}
