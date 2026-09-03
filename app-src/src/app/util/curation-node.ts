// The shapes the curation puts a content into, as pure functions: the node a write is read back as,
// the stand-in for one that does not exist yet, and the picture either of them states. No state and
// no injection — CurationService holds the state and calls these. Its counterpart for the MDS
// editors is `mds-node.ts`, which prepares a node for the wrapper element.

import { HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';

import { DRAFT_NODE_ID } from './mds-node';
import { MdsValues, firstString } from './mds-values';
// Type-only: this leaf module states the shape a save reports back, without depending on the service
// that fetches it.
import type { SavedNode } from '../services/browser-extension.service';

/** The preview image a metadata payload names: `preview_image_url` (agent) or `preview:url` (node). */
export function previewImageOf(payload: Record<string, unknown> | null | undefined): string | null {
  return firstString(payload?.['preview_image_url']) ?? firstString(payload?.['preview:url']);
}

/**
 * When a node was created, as a timestamp; null for a node that states no creation date — a stand-in,
 * or one assembled from what a save reported back. Read from the API's own `createdAt` and from
 * `cm:created`, which a node built from stored properties carries instead; either may be stated as an
 * ISO date or as epoch milliseconds.
 */
export function createdAtOf(node: Node | null | undefined): number | null {
  const stated = node?.createdAt ?? firstString(node?.properties?.['cm:created']);
  if (!stated) return null;
  // A bare number is epoch milliseconds; `Date.parse` would read it as a year.
  const parsed = /^\d+$/.test(stated) ? Number(stated) : Date.parse(stated);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Where a metadata field's value comes from. `'ai'` is a machine's proposal, `'page'` one derived from what
 * the open page states about itself, and `'user'` a value that is simply there — stated by the page, written
 * by an earlier step, or already on the node. The two proposal kinds are offered for acceptance in the form;
 * `'user'` is shown as decided.
 *
 * Both proposal kinds are offered the same way and written to the repository's suggestion store alike
 * (see `proposedFieldsOf`); the distinction says where the value came from, which is what the report and
 * the log go by.
 */
export type FieldOrigin = 'ai' | 'page' | 'user';

/** The origins that mean "a machine proposed this, nobody decided it" — see {@link FieldOrigin}. */
const PROPOSED: readonly string[] = ['ai', 'page'];

/**
 * Provenance per metadata field — the `_origins` map an editor marks the generated fields by. Stated
 * for every field, because an unmentioned one counts as generated. `generated` is the run's own map, which
 * may name either proposal kind, and `recorded` names what the flow set outside it and outranks it: a value
 * a step settled is a decision, whatever proposed it before. Only namespaced keys are fields.
 */
export function fieldOrigins(
  values: Record<string, unknown>,
  generated: unknown,
  recorded: MdsValues,
): Record<string, FieldOrigin> {
  const byRun = (generated ?? {}) as Record<string, unknown>;
  const origins: Record<string, FieldOrigin> = {};
  for (const key of Object.keys(values)) {
    if (!key.includes(':')) continue;
    const stated = byRun[key];
    origins[key] =
      typeof stated === 'string' && PROPOSED.includes(stated) && !(key in recorded)
        ? (stated as FieldOrigin)
        : 'user';
  }
  return origins;
}

/**
 * Stand-in {@link Node} for a content the repository was never asked about. Only the handful of fields
 * the elements fed from it read are filled; the cast declares the rest absent. `metadataset` is stated
 * because an MDS editor resolves its set from the node.
 */
export function toPartialNode(
  nodeId: string,
  uploaded: SavedNode,
  values: MdsValues,
  metadataSet: string,
): Node {
  return {
    ref: { id: nodeId, repo: HOME_REPOSITORY },
    name: uploaded.title ?? nodeId,
    title: uploaded.title ?? undefined,
    description: uploaded.description ?? undefined,
    type: 'ccm:io',
    mediatype: 'link',
    metadataset: metadataSet,
    properties: values,
    access: []
  } as unknown as Node;
}

/**
 * The node a `/nodes` write produced, as the flow's own node: the whole one the endpoint answers with,
 * which is what the steps behind the save work on. Falls back to {@link toPartialNode} for an answer
 * that carries no node, and keeps `metadataset` only where the node names one.
 */
export function toWrittenNode(
  nodeId: string,
  saved: SavedNode,
  full: Record<string, unknown> | null | undefined,
  values: MdsValues,
  metadataSet: string,
): Node {
  if (!full || typeof full !== 'object' || !full['ref']) {
    return toPartialNode(nodeId, saved, values, metadataSet);
  }
  const node = full as unknown as Node;
  return { ...node, metadataset: node.metadataset || metadataSet };
}

/**
 * The node written along the agent's route, with a picture this session can show: the preview it reports
 * belongs to the agent's node and renders as the repository's "no permission" placeholder here. A null
 * `src` drops the preview instead — an empty picture says nothing, the placeholder says the wrong thing.
 */
export function withReadablePreview(node: Node, src: string | null): Node {
  return { ...node, preview: toDraftPreview(src) } as unknown as Node;
}

/**
 * The metadata of a just-written content, as an editor is seeded from it: the payload the save started
 * from with the committed values laid over it. Needed because the values alone are `string[]` and carry
 * no envelope, which leaves a canvas without a content type and its scalar fields blank.
 */
export function toSavedMetadata(
  payload: Record<string, unknown> | null,
  values: MdsValues,
): Record<string, unknown> {
  const saved: Record<string, unknown> = { ...(payload ?? {}) };
  for (const [key, value] of Object.entries(values)) {
    const stated = saved[key];
    saved[key] = typeof stated === 'string' && value.length <= 1 ? value[0] ?? '' : value;
  }
  return saved;
}

/**
 * The fields the WLO canvas can only read as a scalar: its field input derives an array as the empty
 * string, so such a field renders blank however filled it is. These are the single-valued fields of
 * the agent's `core.json`, which is the only schema a node's properties resolve.
 */
const CANVAS_SCALAR_FIELDS: readonly string[] = [
  'cclom:title',
  'cclom:general_description',
  'ccm:wwwurl',
  'preview:url',
  'cclom:general_language'
];

/**
 * Metadata as an editor is seeded from it, with the fields a canvas can only read as a scalar unwrapped
 * (see {@link CANVAS_SCALAR_FIELDS}). A list reaches those fields from every direction: stored node
 * properties and the values a step outside the editor contributes are all `string[]`.
 */
export function withCanvasScalars(values: Record<string, unknown>): Record<string, unknown> {
  const seeded = { ...values };
  for (const field of CANVAS_SCALAR_FIELDS) {
    const value = seeded[field];
    if (Array.isArray(value)) seeded[field] = value[0] ?? '';
  }
  return seeded;
}

/** Name of a draft whose metadata carries no title yet. Never written anywhere. */
const DRAFT_NAME = 'Neuer Inhalt';

/**
 * The access rights the draft node reports. The MDS editor asks the node whether it may be edited
 * before offering a widget, so a stand-in without rights would render read-only.
 */
const DRAFT_ACCESS = ['Read', 'Write', 'Change', 'Delete'];

/**
 * A preview URL the native widget can build its image source from: it appends its own query parameters,
 * which for a URL without a query would land in the path. The trailing `?` gives them something to
 * attach to and is ignored by image hosts.
 */
function previewSource(url: string): string {
  return url.includes('?') ? url : `${url}?`;
}

/**
 * The image source the preview widget builds for a picture the user just picked in it: an object or
 * data URL, which exists nowhere but in this browser. Anything else is the widget rendering a picture
 * that already has a home.
 */
export function isPickedPicture(src: string): boolean {
  return src.startsWith('blob:') || src.startsWith('data:');
}

/** A data URL split into what a node's `preview` states inline: its type and its base64 payload. */
const INLINE_PICTURE = /^data:([^;,]+);base64,(.*)$/s;

/**
 * Read an object URL out into a data URL, so a picked picture survives as a value: the stand-in node
 * the next step's editor is built from states an inline picture as `mimetype` + base64 `data`.
 * Null when it cannot be read, leaving the caller its object URL.
 */
export async function toDataUrl(src: string): Promise<string | null> {
  try {
    const blob = await (await fetch(src)).blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * The `preview` a stand-in node states, in whichever shape the native widget can build an image source
 * from: inline (`mimetype` + `data`) for a picture that exists only in this browser, since the widget
 * appends query parameters no data URL can carry, and by URL for one that has an address.
 */
export function toDraftPreview(src: string | null): Record<string, unknown> | undefined {
  if (!src) return undefined;
  const inline = INLINE_PICTURE.exec(src);
  // `isIcon: false` — the widget shows the picture itself only for a real preview; for an icon it
  // renders the repository's icon element instead, which needs a node the repository knows.
  return inline
    ? { mimetype: inline[1], data: inline[2], isIcon: false, width: 0, height: 0 }
    : { url: previewSource(src), isIcon: false, width: 0, height: 0 };
}

/**
 * The picture a node's `preview` states, as an image source: its address, or the picture itself where
 * it is stated inline. Null for a preview that states no picture of this content — none at all, or a
 * mere type icon.
 */
export function previewSrcOfNode(preview: Node['preview'] | undefined): string | null {
  if (!preview || preview.isIcon) return null;
  if (preview.data && preview.mimetype) return `data:${preview.mimetype};base64,${preview.data}`;
  return preview.url || null;
}

/**
 * Fill in both properties a title widget can be bound to, so the preview step's field is not empty
 * whichever the view group declares: `cclom:title` and `cm:name`, which generated metadata never
 * carries. Neither is overwritten where the metadata already has one.
 */
function withTitleProperties(values: MdsValues, title: string | null): MdsValues {
  if (!title) return values;
  return {
    'cclom:title': [title],
    'cm:name': [title],
    ...values
  };
}

/**
 * Stand-in {@link Node} for a curated content that has no node yet, so the preview step's `<preview>` and
 * title widgets have one to work on. States `metadataset` and `access` because the editor reads both off
 * the node; the set is the panel's own, never the payload's, which names the agent's own template.
 */
export function toDraftNode(
  values: MdsValues,
  title: string | null,
  previewSrc: string | null,
  metadataSet: string,
): Node {
  let node = {
    ref: { id: DRAFT_NODE_ID, repo: HOME_REPOSITORY },
    name: title ?? DRAFT_NAME,
    title: title ?? undefined,
    type: 'ccm:io',
    mediatype: 'link',
    metadataset: metadataSet,
    aspects: [],
    access: DRAFT_ACCESS,
    properties: withTitleProperties(values, title),
    preview: toDraftPreview(previewSrc)
  };
  return node as unknown as Node;
}

/**
 * The node a metadata editor is built on: the content's node with the flow's own findings underneath its
 * stored properties, and what other steps recorded over both.
 *
 * The findings have to be laid under it because the first save writes only picture and title — a form
 * seeded from the node's properties alone would show none of what the Erschließung found, and the next
 * save would commit that emptiness back. The order *is* the precedence: a property the node stores is a
 * value the repository holds and outranks a finding about it, and a value a step settled outranks both.
 */
export function toEditorNode(
  node: Node,
  found: MdsValues,
  recorded: MdsValues,
): Node {
  return { ...node, properties: { ...found, ...node.properties, ...recorded } };
}
