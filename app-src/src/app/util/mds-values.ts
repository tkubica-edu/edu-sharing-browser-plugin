// Value shapes used around the MDS editor. Both the editor and the repository expect every
// property as a `string[]`, so the coercion lives here once.

/** Every property as `string[]`; `null`/`undefined` entries are dropped. */
export type MdsValues = Record<string, string[]>;

/**
 * The first usable string of a single property value — the payloads carry a value as a scalar *or*
 * as an array (a node's stored properties are always arrays, an agent result often is not), and a
 * reader that wants one string should not have to care which.
 *
 * `null` for anything that is not a non-blank string, so a caller can chain fallbacks with `??`.
 */
export function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Coerce arbitrary property values to the `string[]` shape MDS and the repository expect. */
export function toMdsValues(values: Record<string, unknown> | null | undefined): MdsValues {
  const result: MdsValues = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (value === null || value === undefined) continue;
    result[key] = Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value)];
  }
  return result;
}

/**
 * Convert a metadata-agent payload into MDS editor values: keep only namespaced property
 * keys (those containing a `:`, e.g. `cclom:title`) and drop envelope fields (`url`,
 * `description`, `metadataset`, `_origins`, …).
 *
 * `edu-sharing-mds-editor-wrapper` expects already-normalized `currentValues`; without this
 * conversion a scalar field gets indexed like an array and renders as "0".
 */
export function toMdsEditorValues(payload: Record<string, unknown> | null | undefined): MdsValues {
  const namespaced = Object.fromEntries(
    Object.entries(payload ?? {}).filter(([key]) => key.includes(':')),
  );
  return toMdsValues(namespaced);
}
