// The MDS editor's metadata suggestions, as the wrapper's `suggestions` input takes them.
//
// The wrapper accepts the repository's own suggestion payload from outside (see
// `mds-editor-wrapper.suggestions` → `MdsEditorInstanceService.setExternalSuggestions`), which is
// how this panel gets the agent's fields marked as KI-Vorschläge: the editor's own path to them
// needs the mongo-plugin, the b-api and a toolpermission, and generates its own suggestions on top
// (see KI-MARKIERUNG.md). Handing them in needs none of that and works for any repository.

import { toMdsEditorValues } from './mds-values';

/** One proposed value for one property, in the shape the editor's widgets read. */
export interface MdsSuggestion {
  /** Identifies the suggestion while the widget moves it between states; ours are made up here. */
  id: string;
  propertyId: string;
  value: string;
  /** `PENDING` is the only state worth handing in — a widget marks what it applied `ACCEPTED`. */
  status: 'PENDING';
  /** `AI` is what gets the KI colour; `USER_PROPOSAL` is a person's proposal and reads differently. */
  type: 'AI';
}

/** The suggestions for one node, keyed by property — one entry of the wrapper's `suggestions`. */
export interface NodeSuggestions {
  nodeId: string;
  suggestions: Record<string, MdsSuggestion[]>;
}

/**
 * The properties a metadata payload's `_origins` attributes to the metadata agent — the fields whose
 * values are a machine's proposal rather than the user's or the repository's statement.
 *
 * Only what the map says, and only namespaced keys: a payload without `_origins` yields nothing here,
 * rather than declaring everything the agent's (which is how the WLO canvas reads it — see
 * CurationService's `fieldOrigins`, which is why it always writes the map out in full).
 */
export function aiFieldsOf(payload: Record<string, unknown> | null | undefined): string[] {
  const origins = (payload?.['_origins'] ?? {}) as Record<string, unknown>;
  return Object.keys(origins).filter((key) => key.includes(':') && origins[key] === 'ai');
}

/**
 * The agent's fields of a payload as suggestions for one node — `null` when it has none, so the
 * caller can leave the editor's input unset rather than hand it an empty offer.
 *
 * One suggestion per value, because that is the grain the widgets work at: a multi-value widget
 * offers each of them as a chip to take or leave.
 */
export function aiSuggestionsFor(
  payload: Record<string, unknown> | null | undefined,
  nodeId: string,
): NodeSuggestions | null {
  const fields = aiFieldsOf(payload);
  if (!fields.length) return null;
  const values = toMdsEditorValues(payload);
  const suggestions: Record<string, MdsSuggestion[]> = {};
  for (const propertyId of fields) {
    const proposed = (values[propertyId] ?? []).filter((value) => value.trim());
    if (!proposed.length) continue;
    suggestions[propertyId] = proposed.map((value, index) => ({
      id: `es-ai-${propertyId}-${index}`,
      propertyId,
      value,
      status: 'PENDING',
      type: 'AI'
    }));
  }
  return Object.keys(suggestions).length ? { nodeId, suggestions } : null;
}
