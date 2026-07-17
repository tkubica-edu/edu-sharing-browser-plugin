// Converts the /generate payload into MDS editor values — mirrors the logic the
// original `edu-sharing-mds-editor` web component applied internally. Since we now
// embed `edu-sharing-mds-editor-wrapper` directly (which expects already-normalized
// `currentValues`), the extension must do this conversion itself; otherwise scalar
// fields (e.g. a plain string) get indexed like an array and render as "0".

export interface GeneratedMetadataPayload {
  metadataset?: string;
  [key: string]: unknown;
}

/**
 * Keeps only namespaced property keys (those containing a `:`, e.g. `cclom:title`),
 * drops envelope fields (`url`, `description`, `metadataset`, `_origins`, …), and
 * wraps every value in a `string[]` — the shape the MDS editor expects.
 */
export function valuesFromGeneratedMetadata(
  payload: GeneratedMetadataPayload
): Record<string, string[]> {
  const values: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (!key.includes(':') || value === null || value === undefined) {
      continue;
    }
    values[key] = Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value)];
  }
  return values;
}
