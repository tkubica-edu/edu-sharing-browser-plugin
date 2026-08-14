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
 * The wrapper's `editorMode` for a form built on a stand-in node. `nodes` would fit what the step does, but it is
 * also the only mode that fetches metadata suggestions and offers the AI-suggestion controls — all of which fail for
 * a content that does not exist yet. `form` is that mode without them, and its widgets are otherwise unchanged.
 */
export const EDITOR_MODE_FOR_DRAFT = 'form';

/**
 * The node in the shape the MDS machinery requires, which is stricter than the `Node` type says: every widget
 * reduces over its property and calls `.filter()`, so a scalar property throws inside the bundle and the whole
 * form fails to render. `aspects` and `access` are reduced over likewise.
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
  return prepared;
}

/**
 * The picture the mounted editor's preview widget shows, as the `src` of its rendered image — the only way to
 * one the user picked: the widget keeps it as a `File`, reports it through an output only in `standalone` mode
 * and otherwise writes it in its own save. Null while nothing is shown, including a picture the user deleted.
 */
export function previewSrcOf(element: Element | null): string | null {
  const root = element?.querySelector(PREVIEW_WIDGET_TAG) ?? element;
  return root?.querySelector<HTMLImageElement>('img')?.src || null;
}
