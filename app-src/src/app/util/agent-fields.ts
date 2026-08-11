// The metadata agent's field names and values are not always the edu-sharing form's. Applied where that
// form is built and where values are saved, never earlier: the same payload feeds the WLO canvas too,
// which is the agent's own form and reads its own names as they come.

import { MdsValues, firstString } from './mds-values';

export const LICENSE_KEY = 'ccm:commonlicense_key';

/** The licence's version, which the agent states itself (`4.0`) and nothing here decides. */
const LICENSE_VERSION = 'ccm:commonlicense_cc_version';

/** The aspects a node carries its licence under; without them it renders as unlicensed. */
export const LICENSE_ASPECTS: readonly string[] = ['ccm:licenses', 'ccm:commonlicenses'];

/** What the licence block states besides the licence and its version. The agent states none of it. */
const LICENSE_DEFAULTS: Record<string, string> = {
  'ccm:commonlicense_ai_allow_usage': 'true',
  'ccm:commonlicense_ai_generated': 'false',
  'ccm:commonlicense_ai_manually_modified': 'false'
};

/**
 * The licence block, which the form is given as values rather than as a KI-Vorschlag: a licence still to
 * be accepted reads as no licence, and the flags mean nothing without the key. See MdsEditorComponent.
 */
export const LICENSE_FIELDS: readonly string[] = [
  LICENSE_KEY, LICENSE_VERSION, ...Object.keys(LICENSE_DEFAULTS)
];

/**
 * The payload with its values also under the names the edu-sharing form uses:
 *
 * - `ccm:oeh_publisher_combined` copied to `ccm:author_freetext`, which is the free text the agent's
 *   value actually is — the publisher widget takes vocabulary badges instead.
 * - `ccm:commonlicense_key` from the licence's label to its key (`CC BY-SA` → `CC_BY_SA`), plus
 *   {@link LICENSE_DEFAULTS} beside it. Only where a licence is stated: they are statements about one.
 *
 * A new object. Nothing is removed, nothing already stated is overwritten, so running it twice changes
 * nothing the first run did not.
 */
export function mapAgentFields(
  payload: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const mapped = { ...(payload ?? {}) };
  const fill = (field: string, value: string) => {
    if (!firstString(mapped[field])) mapped[field] = [value];
  };

  const publisher = firstString(mapped['ccm:oeh_publisher_combined']);
  if (publisher) fill('ccm:author_freetext', publisher);

  const license = firstString(mapped[LICENSE_KEY]);
  if (license) {
    mapped[LICENSE_KEY] = [license.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')];
    for (const [field, value] of Object.entries(LICENSE_DEFAULTS)) fill(field, value);
  }
  return mapped;
}

/**
 * The values as they are written to the node, with the licence taken from `payload` where the form
 * reported none — not every form has a widget for it, and a value no widget carries never comes back.
 * One the form did report is normalised rather than replaced.
 *
 * On the save rather than in either editor, because both write through it (CurationService.save).
 */
export function withAgentLicense(
  values: MdsValues,
  payload: Record<string, unknown> | null | undefined
): MdsValues {
  const reported = mapAgentFields(values);
  const stated = mapAgentFields(payload);
  const result: MdsValues = { ...values };
  for (const field of LICENSE_FIELDS) {
    const value = firstString(reported[field]) ?? firstString(stated[field]);
    if (value) result[field] = [value];
  }
  return result;
}
