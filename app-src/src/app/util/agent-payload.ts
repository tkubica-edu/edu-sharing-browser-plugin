// The metadata agent's payload as a whole: the envelope it states its values against, the export
// shape it hands the payload over in, and the WLO extended fields that carry that shape onto a node.
//
// Shared by the two ways a curated content is written — the agent's own `/upload`
// (MetadataUploadService) and the panel writing the node itself (CurationService.save) — so both
// state the same payload.

import { MdsValues } from './mds-values';

/**
 * The envelope keys a payload carries alongside the field values: which set the values are read
 * against, and where they came from. They travel at the top level, next to the `metadata` the fields
 * themselves are in (see {@link toExportPayload}).
 *
 * `_source_text` is not among them although the payload carries it: the page's whole raw text is
 * carried separately (as `extended_text` in a request, as `ccm:oeh_extendedText` on a node), and
 * would otherwise travel twice.
 */
export const ENVELOPE_KEYS = [
  'contextName',
  'schemaVersion',
  'metadataset',
  'metadataset_uri',
  'language',
  'exportedAt',
  '_origins',
  'preview_image_url'
] as const;

/** The page's raw text as the agent's payload carries it. */
export const SOURCE_TEXT_KEY = '_source_text';

/**
 * The content type the payload was read against, as a vocabulary URI
 * (`…/vocabs/new_lrt_aggregated/event`). A field of the core schema, so it travels with the values.
 */
export const EXTENDED_TYPE_FIELD = 'ccm:oeh_extendedType';

/** The content type as a learning resource type — the repository's own vocabulary for it. */
export const LRT_FIELD = 'ccm:oeh_lrt';

/** The whole payload as JSON, so the metadata is on the node as the agent stated it. */
export const EXTENDED_DATA_FIELD = 'ccm:oeh_extendedData';

/** The raw text the metadata was read from. */
export const EXTENDED_TEXT_FIELD = 'ccm:oeh_extendedText';

/**
 * The field values as the payload's `metadata`, each as the list the property is.
 *
 * Deliberately NOT unwrapped to a bare value when there happens to be one of it: how many values a
 * property holds right now says nothing about how many it *takes*. `ccm:oeh_buffet_criteria` is a
 * list of criteria, and stating the single one that is ticked as a bare string makes it a different
 * property than the one with two ticked.
 *
 * An empty one is left out altogether — it says nothing, and sending it would clear a field the
 * editor never touched.
 */
export function toPayloadFields(values: MdsValues): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value?.length));
}

/** The envelope of an agent payload, skipping the keys it did not deliver. */
export function toEnvelope(payload: Record<string, unknown> | null): Record<string, unknown> {
  const source = payload ?? {};
  return Object.fromEntries(
    ENVELOPE_KEYS.filter((key) => source[key] !== undefined && source[key] !== null).map((key) => [
      key,
      source[key]
    ]),
  );
}

/**
 * The payload in the shape the canvas states it in (`getMetadataForExport`): the envelope at the top
 * level, the properties one level in under `metadata`. That is the shape the agent's `/upload` reads
 * and the one `ccm:oeh_extendedData` is expected to hold, so it is not the panel's own arrangement
 * to make.
 */
export function toExportPayload(
  values: MdsValues,
  payload: Record<string, unknown> | null,
): Record<string, unknown> {
  return { ...toEnvelope(payload), metadata: toPayloadFields(values) };
}

/**
 * The WLO extended fields for a node: the content type, the whole payload as JSON, and the raw text
 * the metadata was read from.
 *
 * These are the fields the metadata set does not define, so they are written in a call of their own
 * that does not obey it — a write that obeys the set drops them (see
 * RepositoryNodeService.writeExtendedData).
 *
 * A field is only stated where there is something to state: an empty one would clear what the node
 * carries. `ccm:oeh_lrt` in particular is taken over where the payload names it and otherwise left
 * alone — mapping a content type to a learning resource type is the agent's own table, and guessing
 * one would write a value from the wrong vocabulary.
 */
export function toExtendedFields(
  values: MdsValues,
  payload: Record<string, unknown> | null,
): MdsValues {
  const fields: MdsValues = {};
  const state = (field: string, value: string | undefined) => {
    if (value) fields[field] = [value];
  };

  const contentType = values[EXTENDED_TYPE_FIELD]?.[0] ?? stringOf(payload?.[EXTENDED_TYPE_FIELD]);
  const lrt = values[LRT_FIELD]?.[0] ?? stringOf(payload?.[LRT_FIELD]);
  const text = stringOf(payload?.[SOURCE_TEXT_KEY]);

  state(EXTENDED_TYPE_FIELD, contentType);
  state(LRT_FIELD, lrt);
  state(EXTENDED_TEXT_FIELD, text);
  // Last, and never conditional on the others: the payload is what the node is described by, and it
  // is stated for every content — the envelope alone is already a description of one.
  fields[EXTENDED_DATA_FIELD] = [JSON.stringify(toExportPayload(values, payload))];
  return fields;
}

/** A payload value as one string, for the fields that hold exactly one. */
function stringOf(value: unknown): string | undefined {
  if (Array.isArray(value)) return stringOf(value[0]);
  return typeof value === 'string' && value.trim() ? value : undefined;
}
