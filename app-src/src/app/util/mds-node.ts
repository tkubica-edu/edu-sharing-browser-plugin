// What both embedded MDS editors need from a node, kept out of either component so neither has to
// import the other: the shape the wrapper's `nodes` input must be in, and the way back to the
// picture its preview widget shows.

// Type-only, so this leaf utility does not pull the API library into the bundle.
import type { Node } from 'ngx-edu-sharing-api';

import { toMdsEditorValues } from './mds-values';

/** The native preview widget's element — see {@link previewSrcOf}. */
const PREVIEW_WIDGET_TAG = 'es-mds-editor-widget-preview';

/**
 * The node in the shape the MDS machinery requires, which is stricter than the `Node` type says: every
 * widget reduces over the property it is bound to and calls `.filter()` on the value, so a scalar
 * property throws inside the bundle and the whole form fails to render. The app does hand out such
 * nodes — a content the repository will not return is substituted by a stand-in built from the agent's
 * payload (`CurationService.applyStoredEntry`). `aspects` and `access` are reduced over likewise.
 */
export function forMdsEditor(node: Node): Node {
  const prepared = {
    ...node,
    properties: toMdsEditorValues(node.properties),
    aspects: node.aspects ?? [],
    access: node.access ?? []
  };
  // TEMPORARY — the node exactly as the wrapper receives it (`element.nodes`), for both editors.
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
