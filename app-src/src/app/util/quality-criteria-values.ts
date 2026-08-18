// How a quality criterion's answer is written into a node property: which value of the criterion's widget
// means met, violated, or "no machine findings", and which properties the criteria are answered in at all.
// The mapping is the vocabulary's, not the view's, so it lives here and QualityCriteriaComponent stays
// about the boxes the user clicks.

import type { MdsValue, MdsWidget } from 'ngx-edu-sharing-api';

/**
 * The editorial criteria's property: one multi-value property whose widget's values are the criteria, so one
 * of them is met while its id is among the property's values.
 */
export const EDITORIAL_CRITERIA_PROPERTY = 'ccm:oeh_buffet_criteria';

/**
 * The widget listing the knock-out criteria — a table of contents rather than a property of its own: its
 * values are the criteria, and each value's id is the node property that criterion is recorded in.
 */
export const KNOCKOUT_CRITERIA_WIDGET = 'virtual:unmetLegalCriteria';

/**
 * Every node property a quality criterion is answered in: the knock-out criteria, each of which has one of
 * its own, plus the property the editorial ones share. States what the metadata set lists — the values of
 * `virtual:unmetLegalCriteria` — because it is read where no metadata set is at hand, so a criterion the set
 * gains has to be named here as well.
 */
export const CRITERIA_PROPERTIES: readonly string[] = [
  'ccm:oeh_quality_relevancy_for_education',
  'ccm:oeh_quality_criminal_law',
  'ccm:oeh_quality_protection_of_minors',
  'ccm:oeh_quality_data_privacy',
  'ccm:oeh_quality_copyright_law',
  'ccm:oeh_quality_personal_law',
  'ccm:oeh_quality_neutralness',
  EDITORIAL_CRITERIA_PROPERTY
];

/**
 * A metadata-agent payload without the quality criteria it answered itself. A criterion's box states what
 * has been established about the content, and the flow's quality confirmation hangs off those boxes — an
 * LLM's "keine Auffälligkeiten gefunden (Maschine)" establishes nothing, no machine having looked. Dropped
 * from the payload rather than hidden from the boxes, because the payload also seeds the metadata editor:
 * a value left in it would be written to the node by the next save, and the node would then claim what no
 * box shows. What the criteria are rated by beside them (`ccm:oeh_quality_correctness` and the other
 * scales) is left alone — those are ratings, not answers to a criterion.
 */
export function withoutQualityCriteria<T extends Record<string, unknown>>(payload: T): T {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => !CRITERIA_PROPERTIES.includes(key))
  ) as T;
}

/**
 * The quality vocabulary's ids, as a criterion's values carry them in `alternativeIds`
 * (https://vocabs.openeduhub.de/w3id.org/openeduhub/vocabs/quality). Met only while the property holds the
 * value mapped to MET: a content nothing is recorded for is unjudged, which is not "in order".
 */
export const CRITERION_MET = '3';
export const CRITERION_VIOLATED = '0';

/**
 * The same two answers on a widget whose valuespace maps nothing, where the value *ids* are the answer.
 * Only consulted for such a widget — under a mapped vocabulary an unmapped value is one it deliberately
 * does not offer, not one to guess at.
 */
const PLAIN_MET = '1';
const PLAIN_VIOLATED = '0';

/**
 * How a machine's all-clear is recorded, where the criterion's valuespace states a term for it. Matched by
 * the term at the end of the URI rather than through `alternativeIds`: on a rating scale those mean the
 * rating itself.
 */
const AUTO_MET_TERM = 'no_auto_findings';

/** A valuespace id's own term — the last segment of the vocabulary URI, or the bare id. */
function termOf(id: string): string {
  return id.split(/[/#]/).pop() ?? id;
}

/** The widget with this id, from a loaded metadata set. */
export function widgetOf(widgets: readonly MdsWidget[] | undefined, id: string): MdsWidget | undefined {
  return widgets?.find((widget) => widget.id === id);
}

/**
 * The value id that records a machine's all-clear on this criterion, where its valuespace offers one;
 * `undefined` where it does not — see {@link AUTO_MET_TERM}.
 */
export function autoMetValue(widget: MdsWidget | undefined): string | undefined {
  return widget?.values?.find((value) => termOf(value.id) === AUTO_MET_TERM)?.id;
}

/**
 * The value id that means MET / VIOLATED on a criterion's property: the value mapped to that entry of the
 * quality vocabulary, else the plain yes/no id. A mapped vocabulary that lacks the entry has no answer to
 * give, so falling through would pick an unrelated value out of a rating scale.
 */
export function valueFor(widget: MdsWidget | undefined, vocabularyId: string): string | undefined {
  const values = widget?.values ?? [];
  const mapped = values.find((value: MdsValue) => value.alternativeIds?.includes(vocabularyId));
  if (mapped) return mapped.id;
  if (values.some((value: MdsValue) => value.alternativeIds?.length)) return undefined;
  const plain = vocabularyId === CRITERION_MET ? PLAIN_MET : PLAIN_VIOLATED;
  return values.find((value: MdsValue) => value.id === plain)?.id;
}
