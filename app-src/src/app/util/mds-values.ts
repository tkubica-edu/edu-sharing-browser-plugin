// Value shapes used around the MDS editor. Both the editor and the repository expect every
// property as a `string[]`, so the coercion lives here once.

/** Every property as `string[]`; `null`/`undefined` entries are dropped. */
export type MdsValues = Record<string, string[]>;

/**
 * The first usable string of a property value, which the payloads carry as a scalar *or* as an array.
 * `null` for anything that is not a non-blank string, so callers can chain fallbacks with `??`.
 */
export function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * A property's values as separate strings. Beyond the array/scalar split it also splits on commas: a
 * multi-value field's schema describes it as comma-separated, so a payload may state the whole property
 * as one joined string. Blanks are dropped, so an empty property answers with an empty list.
 */
export function stringValues(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => String(entry).split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
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
 * Convert a metadata-agent payload into MDS editor values: keep only namespaced property keys and drop the
 * envelope fields. The wrapper expects already-normalized `currentValues` — without this a scalar field gets
 * indexed like an array and renders as "0".
 */
export function toMdsEditorValues(payload: Record<string, unknown> | null | undefined): MdsValues {
  const namespaced = Object.fromEntries(
    Object.entries(payload ?? {}).filter(([key]) => key.includes(':')),
  );
  return toMdsValues(namespaced);
}
