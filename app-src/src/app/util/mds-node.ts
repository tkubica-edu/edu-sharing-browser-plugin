// What both embedded MDS editors need from a node, kept out of either component so neither has to
// import the other: the shape the wrapper's `nodes` input must be in, and the way back to the
// picture its preview widget shows.

// Type-only, so this leaf utility does not pull the API library into the bundle.
import type { Node } from 'ngx-edu-sharing-api';

import { toMdsEditorValues } from './mds-values';
import { LICENSE_ASPECTS, LICENSE_KEY, mapAgentFields } from './agent-fields';

/** The native preview widget's element — see {@link previewSrcOf}. */
const PREVIEW_WIDGET_TAG = 'es-mds-editor-widget-preview';

/**
 * Stands where a node id belongs on the draft node the curation assembles (`CurationService`). It
 * identifies nothing in the repository, so no request must ever be built from it — which is what
 * {@link isDraftNode} is for.
 */
export const DRAFT_NODE_ID = '-draft-';

/**
 * Whether a node is that stand-in rather than one the repository holds. Decides the editor's mode:
 * `nodes` mode makes the wrapper ask the repository about the node behind the form, and for a
 * stand-in every such request fails — see {@link EDITOR_MODE_FOR_DRAFT}.
 */
export function isDraftNode(node: Node | null | undefined): boolean {
  return node?.ref?.id === DRAFT_NODE_ID;
}

/**
 * The wrapper's `editorMode` for a form built on a stand-in node.
 *
 * `nodes` is the mode that fits what the step does — a form on a node, nothing writing by itself —
 * but it is also the only mode in which `MdsEditorInstanceService.initWithNodes` fetches the node's
 * metadata suggestions (`GET /suggestions/v1/{repo}/{node}`, whenever the repository runs the
 * mongo-plugin). For a stand-in that request 500s and the bundle logs `Could not fetch suggestion
 * data`; the AI-suggestion button and the valuespace-suggestion input come with the mode too and do
 * nothing for a content that does not exist yet. So the mode is the only place to stop all three.
 *
 * `form` is that mode minus those extras: widgets are still built from the node (`initWithNodes` runs
 * whenever `nodes` is set, whatever the mode), still editable, still validated, and
 * `currentValuesChange` still reports every widget's live value.
 *
 * The accepted cost is the licence: its widget renders in `nodes`, `inline` and `viewer` only, so a
 * draft's form shows none, although the set asks for it unconditionally (`io` → `node_general`, no
 * `condition`, no `hideIfEmpty`) and the stand-in carries the properties. It is written on save all the
 * same (`withAgentLicense`) and shows once the content has a node, which renders in `nodes`.
 */
export const EDITOR_MODE_FOR_DRAFT = 'form';

/**
 * The node in the shape the MDS machinery requires, which is stricter than the `Node` type says: every
 * widget reduces over the property it is bound to and calls `.filter()` on the value, so a scalar
 * property throws inside the bundle and the whole form fails to render. The app does hand out such
 * nodes — a content the repository will not return is substituted by a stand-in built from the agent's
 * payload (`CurationService.applyStoredEntry`). `aspects` and `access` are reduced over likewise.
 */
export function forMdsEditor(node: Node): Node {
  // Mapped here because this is what the form is built from: in node mode the editor reads its widget
  // values off `nodes`, not off the metadata handed over besides them.
  const properties = toMdsEditorValues(mapAgentFields(node.properties));
  const prepared = {
    ...node,
    properties,
    // A licence is its properties AND the aspects they belong to, which a stand-in brings none of.
    aspects: properties[LICENSE_KEY]?.length
      ? [...new Set([...(node.aspects ?? []), ...LICENSE_ASPECTS])]
      : node.aspects ?? [],
    access: node.access ?? []
  };
  // TEMPORARY — the node as prepared for the wrapper. The MDS editor withholds the agent's fields
  // afterwards (see MdsEditorComponent), so `element.nodes` may carry less.
  console.log('[mds] node → editor', prepared);
  return prepared;
}

/**
 * The picture the mounted editor's preview widget currently shows, as the `src` of its rendered image.
 * This is the only way to one the user picked in it: the native preview widget keeps that picture as a
 * `File` of its own, reports it through an output only in `standalone` mode (which an MDS group is
 * not) and otherwise writes it exclusively in its own save — `changePreview` on a node, which is not
 * available while the content has none. Its `<img>` however carries it: an object URL for a picked
 * file, the node's preview URL otherwise.
 *
 * `null` while nothing is shown — no picture at all, or one the user deleted.
 */
export function previewSrcOf(element: Element | null): string | null {
  const root = element?.querySelector(PREVIEW_WIDGET_TAG) ?? element;
  return root?.querySelector<HTMLImageElement>('img')?.src || null;
}
