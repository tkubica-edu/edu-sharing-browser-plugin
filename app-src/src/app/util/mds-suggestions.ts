// The MDS editor's metadata suggestions, on both sides of the repository: what the suggestion API is given
// (`aiSuggestionRequests`) and what comes back from it (`storedAiSuggestions`), plus the in-memory stand-in
// for a content the repository holds none for (`aiSuggestionsFor`).
//
// They are handed to the wrapper through its `suggestions` input in every case, also for the ones the
// repository stores: the wrapper fetches those itself, but only its `suggestions` input flips the switch the
// widgets show a proposal under (`showAiSuggestions`).

import {
  CreateSuggestionRequestDto, NodeSuggestionResponseDto, RestConstants
} from 'ngx-edu-sharing-api';

import { LICENSE_FIELDS } from './agent-fields';
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
 * The properties a payload's `_origins` attributes to the metadata agent — the fields whose values a *model*
 * proposed. Only what the map says, and only namespaced keys: a payload without `_origins` yields nothing
 * here rather than declaring everything the agent's.
 *
 * Deliberately `'ai'` alone: this is what decides what is written to the repository's suggestion store
 * ({@link aiSuggestionRequests}), and a value derived from the page's own statements is nothing to ask that
 * store about — it is re-derived from the page whenever the page is read. For what the *form* offers, which
 * covers both kinds, see {@link proposedFieldsOf}.
 */
export function aiFieldsOf(payload: Record<string, unknown> | null | undefined): string[] {
  const origins = (payload?.['_origins'] ?? {}) as Record<string, unknown>;
  return Object.keys(origins).filter((key) => key.includes(':') && origins[key] === 'ai');
}

/** The origins that stand for a proposal rather than for a decided value — see `FieldOrigin`. */
const PROPOSED_ORIGINS: readonly string[] = ['ai', 'page'];

/**
 * The properties the form offers for acceptance: everything a machine proposed, whether a model generated it
 * or it was derived from what the page states about itself. The wider reading of the same map — the widgets
 * show one marking for both, and the difference is only where the value came from.
 */
export function proposedFieldsOf(payload: Record<string, unknown> | null | undefined): string[] {
  const origins = (payload?.['_origins'] ?? {}) as Record<string, unknown>;
  return Object.keys(origins).filter(
    (key) => key.includes(':') && typeof origins[key] === 'string'
      && PROPOSED_ORIGINS.includes(origins[key] as string),
  );
}

/**
 * The proposed fields of a payload as suggestions for one node — a model's and the page-derived ones alike
 * (see {@link proposedFieldsOf}); null where it has none, so the caller can leave the editor's input unset
 * rather than hand it an empty offer. One suggestion per value, which is the grain the widgets work at.
 *
 * Built entirely here, without asking the repository for anything: this is the offer a form gets where no
 * suggestion store and no generation run answered.
 */
export function aiSuggestionsFor(
  payload: Record<string, unknown> | null | undefined,
  nodeId: string,
): NodeSuggestions | null {
  const fields = proposedFieldsOf(payload);
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

/**
 * How sure the agent is of a value, as the suggestion API records it. A flat 1: the agent reports no
 * per-field confidence of its own, and inventing a spread would state a certainty nothing measured.
 */
const AI_CONFIDENCE = 1;

/**
 * The namespaces a proposed property may be in. The repository resolves a `propertyId` through
 * `CCConstants.getValidGlobalName()`, which answers `null` for a prefix it does not know — and the
 * suggestion endpoint hands that `null` straight to `QName.createQName()`, which fails the whole
 * request (`InvalidQNameException`, HTTP 500), not just the one entry.
 *
 * The agent's payload carries names of its own besides the repository's (`schema:datePublished`,
 * `oeh:new_lrt`); those are a vocabulary, not properties of a node, and are left out here.
 */
const PROPOSABLE_NAMESPACES: readonly string[] = ['ccm', 'cclom', 'cm'];

/** Whether a property is one the repository can resolve — see {@link PROPOSABLE_NAMESPACES}. */
function isProposable(propertyId: string): boolean {
  return PROPOSABLE_NAMESPACES.includes(propertyId.split(':')[0]);
}

/**
 * The agent's fields of a payload as the repository's suggestion API takes them — one entry per property
 * and value, which is the grain a suggestion has (it is always single-valued). The licence is left out:
 * it is set rather than proposed, so the form shows a licence chosen instead of one still to be accepted.
 */
export function aiSuggestionRequests(
  payload: Record<string, unknown> | null | undefined,
): CreateSuggestionRequestDto[] {
  const values = toMdsEditorValues(payload);
  return aiFieldsOf(payload)
    .filter((propertyId) => isProposable(propertyId) && !LICENSE_FIELDS.includes(propertyId))
    .flatMap((propertyId) =>
      (values[propertyId] ?? [])
        .filter((value) => value.trim())
        .map((value) => ({
          propertyId,
          value,
          description: RestConstants.SUGGESTION_DESCRIPTION_METHODOLOGY,
          confidence: AI_CONFIDENCE
        })),
    );
}

/**
 * One proposal as the side that *made* it reports it — the answer of the repository's generation run
 * (`EduSharingLlmService.suggestions`). Structural on purpose: the b-API and the repository's own API
 * each declare a DTO of their own, and this is what the two have in common.
 */
export interface ProposedSuggestion {
  id?: string;
  propertyId?: string;
  value?: unknown;
  status?: string;
  type?: string;
}

/**
 * What a generation run reports it proposed, in the shape the widgets read — the offer for a node whose
 * proposals could not be read back from the store (see {@link storedAiSuggestions}), which is the one
 * other place the same values are to be had. A person's proposal and a declined one are left out; every
 * other answer is what the run just made, so it is offered as pending whatever it says of itself.
 *
 * Null where the run proposed nothing usable, so the caller can leave the editor's input unset.
 */
export function proposedAiSuggestions(
  nodeId: string,
  proposals: readonly ProposedSuggestion[] | null | undefined,
): NodeSuggestions | null {
  const suggestions: Record<string, MdsSuggestion[]> = {};
  for (const entry of proposals ?? []) {
    const propertyId = entry.propertyId;
    const value = typeof entry.value === 'string' ? entry.value : String(entry.value ?? '');
    if (!propertyId || !value.trim()) continue;
    if (entry.type === 'USER_PROPOSAL' || entry.status === 'DECLINED') continue;
    const proposed = (suggestions[propertyId] ??= []);
    proposed.push({
      id: entry.id ?? `es-proposed-${propertyId}-${proposed.length}`,
      propertyId,
      value,
      status: 'PENDING',
      type: 'AI'
    });
  }
  return Object.keys(suggestions).length ? { nodeId, suggestions } : null;
}

/**
 * The suggestions the repository stores for a node, in the shape the widgets read: the machine's pending
 * ones only — an accepted or declined suggestion is a decision already taken, and a person's proposal is
 * not what the KI marking is about. Null where the node carries none, so the caller can leave the editor's
 * input unset rather than hand it an empty offer.
 */
export function storedAiSuggestions(
  response: NodeSuggestionResponseDto | null | undefined,
): NodeSuggestions | null {
  if (!response) return null;
  const suggestions: Record<string, MdsSuggestion[]> = {};
  for (const [propertyId, stored] of Object.entries(response.suggestions ?? {})) {
    const pending = (stored ?? [])
      .filter((entry) => entry.type === 'AI' && entry.status === 'PENDING')
      .map((entry) => ({
        id: entry.id,
        propertyId,
        value: String(entry.value ?? ''),
        status: 'PENDING' as const,
        type: 'AI' as const
      }))
      .filter((entry) => entry.value.trim());
    if (pending.length) suggestions[propertyId] = pending;
  }
  return Object.keys(suggestions).length ? { nodeId: response.nodeId, suggestions } : null;
}
