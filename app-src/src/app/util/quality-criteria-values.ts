// How a quality criterion's answer is written into a node property: which value of the criterion's widget
// means met, violated, or "no machine findings". The mapping is the vocabulary's, not the view's, so it
// lives here and QualityCriteriaComponent stays about the boxes the user clicks.

import type { MdsValue, MdsWidget } from 'ngx-edu-sharing-api';

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
