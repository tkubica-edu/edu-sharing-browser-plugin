// Resolving a page's own words to the values a metadata set actually offers.
//
// A vocabulary property does not hold a label, it holds one of the values its widget lists — for the WLO
// vocabularies a `w3id.org/openeduhub/vocabs/…` URI. A value that is not in that list shows as a blank in
// the editor and is found by no search, which is worse than an empty field (see util/quality-check-request.ts,
// which warns about exactly this). So nothing here ever builds a value: it only ever *picks* one the widget
// offered, and answers with nothing where none of them fits.
//
// Deliberately without fuzzy matching. „Deutsch" must not resolve to „Deutsch als Zweitsprache" and „Kunst"
// not to „Kunstgeschichte": a near-miss in a vocabulary is a different concept, not a spelling variant, and
// the cost of a wrong subject or level is a visible, propagating error.

import type { MdsValue, MdsWidget } from 'ngx-edu-sharing-api';

import { normalizeLabel, normalizeSlug } from './german-terms';

/** One resolved value: the term that was matched, the value it names, and how it was recognised. */
export interface ValueMatch {
  term: string;
  value: MdsValue;
  /** Which of the four readings answered — for the log, and for judging a match at a glance. */
  by: 'id' | 'alternativeId' | 'caption' | 'slug';
}

/** A valuespace id's own term — the last segment of a vocabulary URI, or the bare id. */
export function termOf(id: string): string {
  return id.split(/[/#]/).pop() ?? id;
}

/**
 * The value a term names, or `null`. Four readings, in decreasing directness: the term is the value's id
 * already, it is one of the alternative ids the vocabulary carries, it is the value's caption, or it is the
 * readable last segment of its URI (`…/educationalContext/schule`).
 *
 * A caption is compared folded (see `normalizeLabel`), so case and umlaut spelling do not matter — but as a
 * whole: a caption listing several names (`Physik, Astronomie`) is also matched by one of them alone, which
 * is a separation the vocabulary itself made.
 */
export function matchVocabularyValue(
  values: readonly MdsValue[] | undefined,
  term: string,
): ValueMatch | null {
  const stated = (term ?? '').trim();
  const folded = normalizeLabel(stated);
  if (!stated || !folded || !values?.length) return null;

  const byId = values.find((value) => value.id === stated);
  if (byId) return { term: stated, value: byId, by: 'id' };

  const byAlternative = values.find((value) => value.alternativeIds?.includes(stated));
  if (byAlternative) return { term: stated, value: byAlternative, by: 'alternativeId' };

  const byCaption = values.find((value) => captionNames(value.caption).includes(folded));
  if (byCaption) return { term: stated, value: byCaption, by: 'caption' };

  const slug = normalizeSlug(stated);
  const bySlug = values.find((value) => normalizeSlug(termOf(value.id)) === slug);
  if (bySlug) return { term: stated, value: bySlug, by: 'slug' };

  return null;
}

/**
 * The values a list of terms names, in the terms' own order and without repeats — several terms may name the
 * same value, and a property holds it once. `limit` caps how many are taken: a page whose words resolve to
 * eight subjects has not said which one it is about.
 */
export function matchVocabularyValues(
  values: readonly MdsValue[] | undefined,
  terms: readonly string[],
  limit = 2,
): ValueMatch[] {
  const matched: ValueMatch[] = [];
  const held = new Set<string>();
  for (const term of terms) {
    const match = matchVocabularyValue(values, term);
    if (!match || held.has(match.value.id)) continue;
    held.add(match.value.id);
    matched.push(match);
    if (matched.length >= Math.max(0, limit)) break;
  }
  return matched;
}

/**
 * The widget kinds whose component in the edu-sharing bundle displays and applies a pending suggestion:
 * the text widget (which renders text, textarea, number, date, email and colour alike), the select, the
 * radio buttons, the slider, the duration — and the tree, which is also what the badge kinds render as.
 *
 * `multivalueBadges` and `singlevalueSuggestBadges` are the exception: those render as the chips component,
 * whose suggestion chip set is commented out in the bundle, so a proposal there is invisible. Verified
 * against the 11.0 frontend (`features/mds/types/mds-types.ts`, `WidgetComponents`).
 */
const SUGGESTION_CAPABLE_TYPES: readonly string[] = [
  'text', 'textarea', 'number', 'email', 'date', 'month', 'color',
  'singleoption', 'radioHorizontal', 'radioVertical',
  'slider', 'range', 'duration',
  'singlevalueTree', 'multivalueTree', 'multivalueSuggestBadges', 'multivalueFixedBadges'
];

/** The kinds whose component cannot show a proposal at all — see {@link SUGGESTION_CAPABLE_TYPES}. */
const SUGGESTION_BLIND_TYPES: readonly string[] = [
  'multivalueBadges', 'singlevalueSuggestBadges', 'multivalueAuthorityBadges', 'multivalueButtons',
  'checkbox', 'toggle', 'checkboxHorizontal', 'checkboxVertical', 'vcard', 'tinymce', 'nodefilter',
  'facetList', 'defaultvalue'
];

/**
 * Whether a widget can show a proposal for its property. A kind this does not know counts as able: a
 * proposal that does not render is inert, while a value that was never proposed is a claim — so the
 * uncertain case errs towards proposing.
 */
export function suggestionCapableWidget(widget: MdsWidget | null | undefined): boolean {
  const type = widget?.type;
  if (!type) return true;
  if (SUGGESTION_CAPABLE_TYPES.includes(type)) return true;
  return !SUGGESTION_BLIND_TYPES.includes(type);
}

/** A caption's own names: the whole caption, plus the parts it separates with a comma or a slash. */
function captionNames(caption: string | null | undefined): string[] {
  const whole = normalizeLabel(caption);
  if (!whole) return [];
  const parts = (caption ?? '')
    .split(/[,/]/)
    .map((part) => normalizeLabel(part))
    .filter(Boolean);
  return [whole, ...parts];
}
