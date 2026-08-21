// The metadata agent's payload as a whole: the envelope it states its values against, the export shape it is
// handed over in, and the WLO extended fields that carry that shape onto a node. Shared by both ways a
// curated content is written, so each states the same payload.

import { MdsValues } from './mds-values';

/**
 * The envelope keys a payload carries alongside the field values: which set the values are read against, and
 * where they came from. They travel at the top level, next to the `metadata` the fields are in.
 * `_source_text` is left out although the payload carries it — the raw text travels separately.
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
 * What kind of thing the content is, as one URI of the `contentTypes` vocabulary
 * (`…/vocabs/contentTypes/education_offer`). **A single value**: the metadata set describes it as a
 * `singleoption` widget, so a list is refused outright — „Multiple values given for a non-multivalue
 * widget". Not a material type either; those are the two fields below.
 */
export const EXTENDED_TYPE_FIELD = 'ccm:oeh_extendedType';

/**
 * The material types of the content, as URIs of the `new_lrt` vocabulary
 * (`…/vocabs/new_lrt/03ab835b-…`). A list: a content is an Arbeitsblatt and a Video at once.
 */
export const LRT_FIELD = 'ccm:oeh_lrt';

/**
 * The same statement out of the aggregated vocabulary — `…/vocabs/new_lrt_aggregated/6b6786df-…`, its
 * own field because its own valuespace. A list, like {@link LRT_FIELD}.
 */
export const LRT_AGGREGATED_FIELD = 'ccm:oeh_lrt_aggregated';

/** The whole payload as JSON, so the metadata is on the node as the agent stated it. */
export const EXTENDED_DATA_FIELD = 'ccm:oeh_extendedData';

/** The raw text the metadata was read from. */
export const EXTENDED_TEXT_FIELD = 'ccm:oeh_extendedText';

/**
 * The field values as the payload's `metadata`, each as the list the property is. Deliberately not unwrapped
 * to a bare value where there happens to be one of it: how many values a property holds says nothing about
 * how many it takes. An empty one is left out — sending it would clear a field the editor never touched.
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
 * The payload in the shape the canvas states it in: the envelope at the top level, the properties one level
 * in under `metadata`. That is the shape the agent's `/upload` reads and `ccm:oeh_extendedData` is expected
 * to hold, so it is not the panel's own arrangement to make.
 */
export function toExportPayload(
  values: MdsValues,
  payload: Record<string, unknown> | null,
): Record<string, unknown> {
  return { ...toEnvelope(payload), metadata: toPayloadFields(values) };
}

/**
 * The WLO extended fields for a node: content type, the material types, the whole payload as JSON and the raw text
 * the metadata was read from. The metadata set does not define them, hence a call of its own that does not obey it.
 * A field is stated only where there is something to state, and each one with as many values as it holds — one for
 * the content type, every one there is for the material types (see {@link LRT_FIELD}).
 */
export function toExtendedFields(
  values: MdsValues,
  payload: Record<string, unknown> | null,
): MdsValues {
  const fields: MdsValues = {};
  const state = (field: string, value: string | undefined) => {
    if (value) fields[field] = [value];
  };
  const stateAll = (field: string) => {
    const stated = values[field]?.length ? values[field] : listOf(payload?.[field]);
    if (stated.length) fields[field] = [...stated];
  };

  const contentType = values[EXTENDED_TYPE_FIELD]?.[0] ?? stringOf(payload?.[EXTENDED_TYPE_FIELD]);
  const text = stringOf(payload?.[SOURCE_TEXT_KEY]);

  state(EXTENDED_TYPE_FIELD, contentType);
  stateAll(LRT_FIELD);
  stateAll(LRT_AGGREGATED_FIELD);
  state(EXTENDED_TEXT_FIELD, text);
  // Last, and never conditional on the others: the payload is what the node is described by, and it
  // is stated for every content — the envelope alone is already a description of one.
  fields[EXTENDED_DATA_FIELD] = [JSON.stringify(toExportPayload(values, payload))];
  return fields;
}

/** A payload value as the list of strings it stands for, for the fields that hold several. */
function listOf(value: unknown): readonly string[] {
  const stated = Array.isArray(value) ? value : [value];
  return stated.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim());
}

/** A payload value as one string, for the fields that hold exactly one. */
function stringOf(value: unknown): string | undefined {
  if (Array.isArray(value)) return stringOf(value[0]);
  return typeof value === 'string' && value.trim() ? value : undefined;
}
