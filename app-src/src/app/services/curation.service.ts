import { Injectable, computed, inject, signal } from '@angular/core';
import { CollectionServiceUnwrapped, DEFAULT, HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { WorkflowStatus } from '../model/workflow';
import { DRAFT_NODE_ID } from '../util/mds-node';
import { MdsValues, firstString, toMdsEditorValues } from '../util/mds-values';
import { errorMessage } from '../util/errors';
import { renderLink } from '../util/repository-links';
import { AdditionalWebComponentService } from './additional-web-component.service';
import { AuthService } from './auth.service';
import { UploadedNode } from './browser-extension.service';
import { HistoryEntry, HistoryService } from './history.service';
import { MetadataAgentService } from './metadata-agent.service';
import { MetadataUploadService } from './metadata-upload.service';
import { NodeSummary, RepositoryNodeService } from './repository-node.service';

/** A collection the content was added to. */
export interface Collection {
  id: string;
  name: string;
}

/**
 * The content's picture: an image URL plus whether it is only the repository's *type* icon rather than
 * a rendered preview — see {@link CurationService.contentPreview}.
 */
export interface ContentPreview {
  url: string;
  isIcon: boolean;
}

/**
 * How the active node became the app's content.
 *
 * - `detected` — it arrived on its own: the host page announced the document it has open
 *   (`DOCUMENT_INFO`) or asked for a node to be shown (`PREVIEW_NODE`). Nobody picked it, so it
 *   describes the *page*, and it stays the app's content for as long as that page is open.
 * - `chosen` — the user picked or created it (Verlauf, Eigene Inhalte, a new document). It belongs
 *   to the flow the user started, so it is released again when that flow ends (see
 *   {@link CurationService.releaseChosenContent}).
 */
export type NodeSource = 'detected' | 'chosen';

/**
 * Reads the picture the open step's editor currently shows, as an image source (an object URL for one
 * the user picked in its preview widget, the preview URL otherwise) — see
 * {@link CurationService.registerDraftPreviewSource}.
 */
export type DraftPreviewSource = () => string | null;

/** The preview image a metadata payload names: `preview_image_url` (agent) or `preview:url` (node). */
function previewImageOf(payload: Record<string, unknown> | null | undefined): string | null {
  return firstString(payload?.['preview_image_url']) ?? firstString(payload?.['preview:url']);
}

/**
 * Provenance per metadata field, the `_origins` map an editor marks the generated fields by (the WLO
 * canvas colours them): `'ai'` for what the metadata agent filled, `'user'` for everything else.
 *
 * Stated for EVERY field, because a field the map does not mention counts as generated — as does
 * every field of a payload that carries no map at all. So the properties of a node, which say nothing
 * about where they came from, would otherwise all be presented as the agent's work.
 *
 * `generated` is the agent run's own map: it still holds once its values have been written to a node,
 * since those are the very values it filled. `recorded` names what the flow set outside the agent
 * (see {@link CurationService.recordValues}) and therefore outranks it.
 *
 * Only namespaced keys are field names (`cclom:title`); the rest is envelope (`metadataset`,
 * `preview_image_url`, …), the same line {@link toMdsEditorValues} draws.
 */
function fieldOrigins(
  values: Record<string, unknown>,
  generated: unknown,
  recorded: MdsValues,
): Record<string, 'ai' | 'user'> {
  const byAgent = (generated ?? {}) as Record<string, unknown>;
  const origins: Record<string, 'ai' | 'user'> = {};
  for (const key of Object.keys(values)) {
    if (!key.includes(':')) continue;
    origins[key] = byAgent[key] === 'ai' && !(key in recorded) ? 'ai' : 'user';
  }
  return origins;
}

/**
 * Assemble a stand-in {@link Node} for a content the repository was never asked about — the one the
 * metadata agent's `/upload` created and described itself (see
 * {@link CurationService.applyUploadedNode}).
 *
 * A real `Node` has ~30 fields; the elements fed from it read a handful (`ref.id`, `name`, `title`,
 * `mediatype`, `properties`), so only those are filled and the cast declares the rest absent. It is
 * a *repository content* (`ccm:io`) whose file is the linked web page — which is what `mediatype`
 * and `type` say, so the usages element and the preview treat it like any other such node.
 *
 * `metadataset` is stated for the same reason as on the draft: an MDS editor initialised with a node
 * resolves its set from the *node*, so a stand-in without one would resolve none at all.
 */
function toPartialNode(nodeId: string, uploaded: UploadedNode, values: MdsValues): Node {
  return {
    ref: { id: nodeId, repo: HOME_REPOSITORY },
    name: uploaded.title ?? nodeId,
    title: uploaded.title ?? undefined,
    description: uploaded.description ?? undefined,
    type: 'ccm:io',
    mediatype: 'link',
    metadataset: DEFAULT,
    properties: values,
    access: []
  } as unknown as Node;
}

/** Name of a draft whose metadata carries no title yet. Never written anywhere. */
const DRAFT_NAME = 'Neuer Inhalt';

/**
 * The access rights the draft node reports. The MDS editor asks the *node* whether it may be edited
 * (`hasAccessPermission(node, 'Write')`) before it offers a widget for editing, and a stand-in with
 * no rights would render as read-only. It stands for a content the user is about to create, so it
 * states the rights they will have on it.
 */
const DRAFT_ACCESS = ['Read', 'Write', 'Change', 'Delete'];

/**
 * A preview URL in the shape the native MDS preview widget can build its image source from: it
 * appends its own parameters (`&crop=true&width=…`), which for a URL that carries no query at all
 * would land in the path and fetch nothing. A trailing `?` gives that `&` something to attach to;
 * the empty first parameter is ignored by image hosts.
 */
function previewSource(url: string): string {
  return url.includes('?') ? url : `${url}?`;
}

/**
 * The image source the preview widget builds for a picture the user just picked in it: an object or
 * data URL, which exists nowhere but in this browser. Anything else is the widget rendering a picture
 * that already has a home.
 */
function isPickedPicture(src: string): boolean {
  return src.startsWith('blob:') || src.startsWith('data:');
}

/** A data URL split into what a node's `preview` states inline: its type and its base64 payload. */
const INLINE_PICTURE = /^data:([^;,]+);base64,(.*)$/s;

/**
 * Read an object URL out into a data URL. Needed because a picked picture has to survive as a *value*
 * rather than as a reference: it goes onto the stand-in node the next step's editor is built from, and
 * a node states an inline picture as `mimetype` + base64 `data` — see {@link toDraftPreview}.
 *
 * `null` when the picture cannot be read; the caller then keeps the object URL, which still renders
 * for as long as this document lives.
 */
async function toDataUrl(src: string): Promise<string | null> {
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
 * The `preview` a stand-in node states for a picture, in whichever of the two shapes the native
 * widget can build its image source from:
 *
 * - **inline** (`mimetype` + `data`) for a picture the user picked, which exists only in this browser.
 *   It has to be this shape: to a `preview.url` the widget appends its own parameters
 *   (`…&crop=true&width=400&height=300`), and neither a data URL nor an object URL can carry those.
 * - **by URL** for a picture that has an address — then {@link previewSource} makes sure that append
 *   lands in a query string rather than in the path.
 */
function toDraftPreview(src: string | null): Record<string, unknown> | undefined {
  if (!src) return undefined;
  const inline = INLINE_PICTURE.exec(src);
  // `isIcon: false` — the widget shows the picture itself only for a real preview; for an icon it
  // renders the repository's icon element instead, which needs a node the repository knows.
  return inline
    ? { mimetype: inline[1], data: inline[2], isIcon: false, width: 0, height: 0 }
    : { url: previewSource(src), isIcon: false, width: 0, height: 0 };
}

/**
 * Fill in the properties a title widget can be bound to, so the preview step's title field is not
 * empty whichever of them the view group declares. edu-sharing has two for one thing: `cclom:title`,
 * the content's title, and `cm:name`, the node's name — which is what its own preview sidebar edits,
 * and which generated metadata never carries (see RepositoryNodeService.toCreateBody).
 *
 * Neither is overwritten where the metadata already has one.
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
 * Assemble the stand-in {@link Node} for a content that has just been curated and has no node in the
 * repository yet — the one the preview step hands to the MDS editor, so the view group's `<preview>`
 * and title widgets have a node to work on (see {@link CurationService.draftNode}).
 *
 * Beyond {@link toPartialNode} two fields matter, both because the editor reads them off the *node*
 * rather than off its own inputs: `metadataset` (the editor's `setId` input only applies to a
 * node-less editor, so a draft without it would resolve no metadata set) and `access`
 * (see {@link DRAFT_ACCESS}).
 *
 * The set is always the repository default, never the `metadataset` of the agent's payload: that
 * names the agent's own extraction template (`learning_material.json`), not a set the repository
 * knows — asking for it 404s and the step stays blank.
 */
function toDraftNode(values: MdsValues, title: string | null, previewSrc: string | null): Node {
  let node = {
    ref: { id: DRAFT_NODE_ID, repo: HOME_REPOSITORY },
    name: title ?? DRAFT_NAME,
    title: title ?? undefined,
    type: 'ccm:io',
    mediatype: 'link',
    metadataset: DEFAULT,
    aspects: [],
    access: DRAFT_ACCESS,
    properties: withTitleProperties(values, title),
    preview: toDraftPreview(previewSrc)
  };
  console.log(node);
  return node as unknown as Node;
}

/**
 * The node the app currently works on, plus its link into the repository UI.
 *
 * `name` is **`null` while the node's real name is unknown** (its load failed). It must never be
 * substituted with the node id: the name carries the document's file name incl. extension and is
 * written back as `cm:name` on save, so a placeholder would rename the document — see
 * {@link save} and `RepositoryNodeService.update`.
 */
export interface ActiveNode {
  nodeId: string;
  name: string | null;
  link: string;
}

// The node the app works on, plus the actions the flow's steps run on it (curating, saving,
// assigning). Navigation lives in NavigationService and ActionBarService — this service only owns
// the node and its side-effecting operations.
@Injectable({ providedIn: 'root' })
export class CurationService {
  private readonly auth = inject(AuthService);
  private readonly metadataAgent = inject(MetadataAgentService);
  private readonly metadataUpload = inject(MetadataUploadService);
  private readonly additionalWebComponent = inject(AdditionalWebComponentService);
  private readonly repositoryNodes = inject(RepositoryNodeService);
  private readonly history = inject(HistoryService);
  // The generated CollectionV1Service (exported as CollectionServiceUnwrapped) — the read-only
  // CollectionService wrapper does not cover adding a node.
  private readonly collections = inject(CollectionServiceUnwrapped);

  readonly activeNode = signal<ActiveNode | null>(null);

  /** How the active node arrived; `null` while there is none. */
  private readonly nodeSource = signal<NodeSource | null>(null);

  /** An active node that arrived on its own — see {@link NodeSource}. */
  readonly hasDetectedNode = computed(
    () => this.activeNode() !== null && this.nodeSource() === 'detected',
  );

  /** How the active node arrived, for carrying it across a page change (SessionResumeService). */
  readonly nodeSourceOf = this.nodeSource.asReadonly();
  /** The active node's stored properties, fed to the metadata editor. */
  readonly nodeMetadata = signal<MdsValues | null>(null);

  /**
   * A page the metadata editor should erschließen itself, for a content whose source is known but
   * whose metadata is not — a link that was just added to the repository (see
   * AddMaterialScreenComponent). The WLO canvas runs the agent on it as it mounts; `null` means
   * there is nothing to extract.
   */
  readonly extractionUrl = signal<string | null>(null);

  /**
   * Take the pending source page over, clearing it: the extraction belongs to the editor that is
   * opening now, and re-entering the sub step later must not run the agent over the page again.
   */
  takeExtractionUrl(): string {
    const url = this.extractionUrl();
    if (url) this.extractionUrl.set(null);
    return url ?? '';
  }

  /**
   * Bumped whenever {@link nodeMetadata} carries values that REPLACE what is in the editor (the
   * result of {@link rerunForActiveNode}), so the editor reseeds instead of keeping its own state
   * — see WloCanvasComponent.seedVersion.
   */
  readonly editorSeedVersion = signal(0);
  /** The full hydrated node, fed to the preview element. */
  readonly previewNode = signal<Node | null>(null);

  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly assigning = signal(false);
  readonly assignError = signal<string | null>(null);
  readonly assignedCollections = signal<readonly Collection[]>([]);

  readonly running = this.metadataAgent.running;

  /** Set while a generated result still waits to be saved; see {@link hasUnsavedWork}. */
  private readonly resultPending = signal(false);

  /** What the preview step's editor last reported; see {@link reportDraftValues}. */
  private readonly draftValues = signal<MdsValues | null>(null);

  /**
   * Properties recorded by a step that is not the metadata editor — the Qualitätsprüfung's criteria.
   *
   * Held here rather than written where they are set, because at that point there is usually no node
   * to write them to: a curated content becomes one only on the save at the end of the flow. So they
   * join the metadata like everything else the flow collects, and that one save writes them all.
   * See {@link recordValues}.
   */
  private readonly recordedValues = signal<MdsValues>({});

  /**
   * What the metadata editor committed while the flow still had steps to go — the values of the
   * Metadaten view, held from the moment that view is left until the save at the end of the first
   * big step (see {@link hold} and {@link saveCollected}).
   *
   * Separate from {@link recordedValues} although both wait for the same save, because they say
   * different things about their fields: these ARE the editor's values, so a field the metadata
   * agent filled is still the agent's — see {@link fieldOrigins}, where only the recorded ones
   * count as the user's own answer.
   */
  private readonly heldValues = signal<MdsValues>({});

  /**
   * The quality was confirmed in the Qualitätsprüfung. Kept as state of the flow rather than read
   * back from the node: the confirmation is usually given before there is a node at all, and it is
   * the same statement either way — see {@link confirmQuality}.
   */
  private readonly quality = signal(false);
  readonly qualityConfirmed = this.quality.asReadonly();

  /** Why a confirmation could not be recorded; null while none failed. */
  readonly qualityError = signal<string | null>(null);

  /** Set while a confirmation waits for the node the save will create. */
  private qualityPending = false;

  /** Reads the preview step's picture while that step is open; see {@link registerDraftPreviewSource}. */
  private draftPreviewSource: DraftPreviewSource | null = null;

  /**
   * The picture the preview step handed over, waiting for a node to be written to; see
   * {@link writePendingPreview}.
   */
  private readonly pendingPreview = signal<string | null>(null);

  /** Set once the metadata was written at least once; see {@link metadataSaved}. */
  private readonly saved = signal(false);

  /**
   * The metadata has been written at least once. Only the *wording* of the save step depends on it
   * ("erneut speichern") — editing stays open: the save created (or found) the active node, so every
   * further save updates that node in place (see {@link save}).
   */
  readonly metadataSaved = this.saved.asReadonly();

  /**
   * No editing right now, because a save is in flight: the values have been read and are being
   * written, so changing them would silently diverge from what lands in the repository.
   */
  readonly metadataLocked = computed(() => this.saving());

  /** A metadata-agent result or an active node exists. */
  readonly hasEditableMetadata = computed(
    () => this.metadataAgent.lastRun()?.ok === true || this.activeNode() !== null,
  );

  /**
   * A generated result that has not been written to a node yet — loading another entry would
   * discard it, so the caller confirms first. Tracked explicitly rather than derived from "no
   * active node": a result can already have its target node (a document found open) and still be
   * unsaved.
   */
  readonly hasUnsavedWork = this.resultPending.asReadonly();

  /**
   * Whether {@link saveCollected} still has anything to do: a content without a node has to be
   * created, and one that already has a node is written again only for the values the flow collected
   * since. Without this a step that was merely passed through would update the node with nothing.
   */
  readonly hasCollectedValues = computed(
    () =>
      !this.activeNode() ||
      Object.keys(this.recordedValues()).length > 0 ||
      Object.keys(this.heldValues()).length > 0,
  );

  /**
   * Metadata fed to the editor: the active node's properties if present, else the agent
   * payload. Falls back to the payload while the node metadata loads, so the editor never
   * briefly unmounts.
   *
   * What other steps have recorded ({@link recordValues}) lies on top, so the flow has ONE picture of
   * the content's metadata: the step that recorded them reads its own values back from here, and the
   * editor is seeded with them rather than committing over them as if they were never set.
   *
   * Carries `_origins` for the whole set, so an editor that marks the generated fields marks the
   * agent's and only the agent's — see {@link fieldOrigins}.
   */
  readonly editorMetadata = computed<Record<string, unknown> | null>(() => {
    const payload = this.metadataAgent.lastRun()?.parsed?.raw ?? null;
    const base = this.activeNode() ? this.nodeMetadata() ?? payload : payload;
    const recorded = this.recordedValues();
    // The editor's own held values on top of them: they are the later word on the same fields, and
    // it is the editor's — a step that recorded a property before it was edited must not win.
    const collected = { ...recorded, ...this.heldValues() };
    const values = Object.keys(collected).length ? { ...(base ?? {}), ...collected } : base;
    if (!values) return null;
    return { ...values, _origins: fieldOrigins(values, payload?.['_origins'], recorded) };
  });

  /**
   * What to call the content: the title its metadata carries, else the node's own title, else its
   * name (the file name). Never the node id — an id is not a title; `null` means no name is known.
   */
  readonly contentTitle = computed<string | null>(
    () =>
      firstString(this.editorMetadata()?.['cclom:title']) ??
      firstString(this.previewNode()?.title) ??
      firstString(this.activeNode()?.name),
  );

  /**
   * The content's picture, for wherever it is shown as itself. Four sources, ranked by how much each
   * says about *this* content; null when none of them has one.
   *
   * 1. A picture the user picked in a step's preview widget, once that step handed it over. It
   *    outranks the rest because it is a decision rather than a finding — and because it is what the
   *    save will write, so every view of the content has to agree with it beforehand.
   * 2. The node's rendered preview — the repository's own picture of a content it holds.
   * 3. The image the metadata agent found (`preview_image_url`, the page's `og:image`), which is what
   *    a curated content has instead. Read from the editor's metadata *and* from the agent's result,
   *    since {@link editorMetadata} swaps in the node's stored properties on the first save.
   * 4. The node's type icon (`preview.isIcon`) — true of the kind of material, but not of this one,
   *    so a real image comes first.
   */
  readonly contentPreview = computed<ContentPreview | null>(() => {
    const picked = this.pendingPreview();
    if (picked) return { url: picked, isIcon: false };
    const preview = this.previewNode()?.preview;
    if (preview?.url && !preview.isIcon) return { url: preview.url, isIcon: false };
    const found =
      previewImageOf(this.editorMetadata()) ??
      previewImageOf(this.metadataAgent.lastRun()?.parsed?.raw);
    if (found) return { url: found, isIcon: false };
    return preview?.url ? { url: preview.url, isIcon: true } : null;
  });

  /**
   * The stand-in node for the content that has just been curated — what the preview step edits, since
   * that content has no node in the repository yet (see {@link toDraftNode}). `null` when there is no
   * curated result to build one from.
   *
   * Deliberately a method rather than a computed signal: the MDS editor re-initialises whenever its
   * `nodes` property changes, and the values this node is built from are the ones that editor reports
   * back — as a signal it would rebuild the form under the user's hands. The caller reads it once, as
   * the step opens.
   */
  draftNode(): Node | null {
    if (this.metadataAgent.lastRun()?.ok !== true) return null;
    return toDraftNode(
      toMdsEditorValues(this.editorMetadata()),
      this.contentTitle(),
      this.currentPreviewSrc(),
    );
  }

  /** The content's picture as an image source, dropping a mere type icon — see {@link contentPreview}. */
  private currentPreviewSrc(): string | null {
    const preview = this.contentPreview();
    return preview && !preview.isIcon ? preview.url : null;
  }

  /**
   * The node the Qualitätsprüfung's metadata editor works on: the content's own once there is one,
   * else the draft the curation stands for (see {@link draftNode}). `null` when there is neither —
   * the editor then falls back to editing a plain values map, without the widgets that need a node.
   *
   * A method for the same reason as {@link draftNode}: the editor re-initialises on every `nodes`
   * change, so the caller reads it once as the screen opens.
   *
   * Everything the flow has collected but not written yet ({@link recordValues}, {@link hold}) is
   * laid over the node's stored properties — for a *draft* that already happened (it is built from
   * {@link editorMetadata}), but a saved node carries what the repository holds, which is not yet
   * what the flow does. Without this the editor would open on the older values and commit them back
   * over the newer ones.
   */
  editorNode(): Node | null {
    const node = this.previewNode();
    if (!node) return this.draftNode();
    const collected = { ...this.recordedValues(), ...this.heldValues() };
    if (!Object.keys(collected).length) return node;
    return { ...node, properties: { ...node.properties, ...collected } };
  }

  /**
   * Take over the values the preview step's editor reports — its title widget, and whatever else the
   * view group carries. Only remembered here: feeding them back into the metadata while the step is
   * open would re-seed the very editor that reported them (see {@link draftNode}), so they are
   * applied when the step is left — see {@link applyDraftValues}.
   */
  reportDraftValues(values: MdsValues): void {
    this.draftValues.set(values);
  }

  /**
   * Take over properties a step outside the metadata editor has recorded — the Qualitätsprüfung's
   * criteria. They show up in {@link editorMetadata} at once and are written by the next
   * {@link save}, which is where the content gets its node in the first place.
   *
   * Merged per property rather than replacing the lot, so two steps recording different properties
   * do not overwrite each other.
   */
  recordValues(values: MdsValues): void {
    this.recordedValues.update((recorded) => ({ ...recorded, ...values }));
  }

  /**
   * Take the metadata editor's committed values over WITHOUT writing them — the hand-over when the
   * Metadaten view is left for the steps that still follow it (see ActionBarService). The editor is
   * gone from there on, so this is the flow's copy of what it held; the save at the end of the step
   * writes it (see {@link saveCollected}).
   *
   * The picture goes with them for the same reason: it is read off the widget that is on screen and
   * nowhere else (see {@link pickedPreviewSrc}), so a picture picked here would otherwise be lost
   * with the view that shows it.
   */
  async hold(values: MdsValues): Promise<void> {
    this.heldValues.update((held) => ({ ...held, ...values }));
    const picked = await this.resolveDraftPreview(this.pickedPreviewSrc());
    if (picked) this.pendingPreview.set(picked);
  }

  /**
   * Write everything the flow has collected: the values the editor handed over ({@link hold}) and
   * what the other steps recorded ({@link recordValues}). The save at the END of the first big step,
   * where there is no editor left to commit.
   */
  saveCollected(): Promise<boolean> {
    return this.save({});
  }

  /**
   * Confirm the content's quality: a workflow status on its node
   * ({@link WorkflowStatus.ELEMENT_LEGALLY_APPROVED}).
   *
   * A status is written to a node, and at the step this is given there usually is none yet — so a
   * content that has one is confirmed on the spot, and a content that has not is confirmed by the
   * save that creates it (see {@link writePendingQuality}). Either way the confirmation itself holds
   * from the moment it is given: it is a statement about the content, not about the node.
   */
  async confirmQuality(): Promise<void> {
    this.quality.set(true);
    this.qualityError.set(null);
    const nodeId = this.activeNode()?.nodeId;
    if (!nodeId) {
      this.qualityPending = true;
      return;
    }
    await this.writeQualityStatus(nodeId);
  }

  /**
   * Let the step that is open say which picture its editor shows, for as long as it is open. Pulled
   * rather than pushed: the native preview widget announces a picked picture through no output at all
   * (see `previewSrcOf`), so it is read at the one moment it matters — when the step hands over
   * ({@link applyDraftValues}) or when the save runs ({@link writePendingPreview}).
   *
   * Two steps register: the preview step of "Inhalt erschließen" and, once its editor runs on a node, the
   * Qualitätsprüfung. Only one of them is ever mounted, so the single slot is enough.
   */
  registerDraftPreviewSource(source: DraftPreviewSource): void {
    this.draftPreviewSource = source;
  }

  /** Counterpart of {@link registerDraftPreviewSource}; pairs by identity. */
  clearDraftPreviewSource(source: DraftPreviewSource): void {
    if (this.draftPreviewSource === source) this.draftPreviewSource = null;
  }

  /**
   * Take everything the preview step holds into the curated result, so the steps after it work on it:
   * the metadata editor opens on the adjusted title, and the save writes both it and the picture.
   *
   * The values go into the agent's payload, because that payload *is* the flow's metadata as long as
   * there is no node (see {@link editorMetadata}); the display fields are re-derived from the merged
   * values rather than patched, so the field views stay consistent with them. The picture cannot
   * travel that way — it is content, not a property — so it is parked until there is a node to write
   * it to (see {@link writePendingPreview}).
   */
  async applyDraftValues(): Promise<void> {
    // Read before the guard below: a run whose widgets the user never touched still shows a picture,
    // and that picture is exactly what the step was there to confirm.
    this.pendingPreview.set(await this.resolveDraftPreview(this.draftPreviewSource?.() ?? null));
    const values = this.draftValues();
    const run = this.metadataAgent.lastRun();
    if (!values || !run?.parsed) return;
    this.draftValues.set(null);
    const raw = { ...run.parsed.raw, ...values };
    this.metadataAgent.restore({ ...run, parsed: this.metadataAgent.parse(raw) });
  }

  /**
   * Turn what the preview widget shows into the picture to write after the save.
   *
   * An object or data URL is one the user picked in the widget and exists nowhere else — that source
   * is taken as it is. Anything else is the widget's own rendering of the node preview, scaled and
   * cache-busted (`…&crop=true&width=400&height=300&dontcache=…`); for that the original URL is used
   * instead, so the node gets the full picture rather than a 400×300 crop of it.
   */
  private draftPreviewOf(src: string | null): string | null {
    if (!src) return null;
    return isPickedPicture(src) ? src : this.currentPreviewSrc();
  }

  /**
   * {@link draftPreviewOf}, plus reading an object URL out into a data URL: a picked picture has to
   * travel as a value, because the node the *next* step's editor is built from states it inline
   * (see {@link toDraftPreview}) — otherwise that step would keep showing the picture the run found
   * while the save writes the one the user chose.
   */
  private async resolveDraftPreview(src: string | null): Promise<string | null> {
    const picture = this.draftPreviewOf(src);
    if (!picture?.startsWith('blob:')) return picture;
    return (await toDataUrl(picture)) ?? picture;
  }

  /**
   * A picture the user picked in the editor that is open right now — and *only* that. Unlike
   * {@link draftPreviewOf} an unchanged picture is not taken: at save time the widget usually shows
   * the node's own preview, and writing that back onto the same node would upload it to itself on
   * every save.
   */
  private pickedPreviewSrc(): string | null {
    const src = this.draftPreviewSource?.() ?? null;
    return src && isPickedPicture(src) ? src : null;
  }

  /**
   * Write the picture the preview step carried over onto the node that has just been saved. It could
   * not be written any earlier: a preview is content, so it goes to a node (`changePreview`) — and
   * until this save there was none, the step worked on a stand-in (see {@link draftNode}).
   *
   * The picture can also come from the editor that is open right now: since its own preview widget
   * runs on a node too, a picture picked *there* has the same nowhere to go. It is read at save time
   * for the same reason the preview step's is read at hand-over — the widget reports it in no other
   * way. That one wins: it is the later of the two, chosen after seeing what the preview step passed
   * on, and only a deliberately picked picture counts as one at all (see {@link pickedPreviewSrc}).
   *
   * A bonus, never a reason for the save to fail: the metadata is written either way, and a source
   * that will not hand the picture out (or a repository that refuses it) simply leaves the node with
   * whatever preview it derived itself. Cleared as soon as it is attempted, so a second save does not
   * upload it again over a picture that may have been replaced in the meantime.
   */
  private async writePendingPreview(nodeId: string): Promise<void> {
    const src = this.pickedPreviewSrc() ?? this.pendingPreview();
    if (!src) return;
    this.pendingPreview.set(null);
    try {
      const image = await (await fetch(src)).blob();
      if (!image.type.startsWith('image/')) return;
      await this.repositoryNodes.setPreview(nodeId, image);
    } catch {
      /* the node keeps the preview the repository derived for it */
    }
  }

  /** Clear the whole flow for a fresh analysis. */
  startNew(): void {
    this.metadataAgent.reset();
    this.resetNodeState();
  }

  /**
   * Release a content the user picked, now that the steps it was picked for have been left: the main
   * menu was reached (NavigationService.openMenu), or the back button stepped back to a view that
   * does not need a content — the picker it was picked in, for instance (NavigationService.back).
   * A `detected` node is kept: it describes the page that is still open, not a flow the user walked
   * out of.
   *
   * Only an actual node is released. A curated result that has no node yet survives, since nothing
   * else holds it and the user has not saved it anywhere.
   */
  releaseChosenContent(): void {
    if (this.activeNode() && this.nodeSource() !== 'detected') this.startNew();
  }

  /**
   * The mirror image: release a content that described the page just left — a `detected` one, whose
   * whole statement was about that page. A picked content stays; it belongs to the flow the user
   * started, not to the page they happened to be on.
   *
   * For a page that changes *under the panel* without reloading it (an edu-sharing page routing in
   * place, see AppComponent). A reboot needs none of this — it starts with no content at all, and
   * SessionResumeService decides there whether a stored one still applies.
   *
   * Unsaved work outranks the page change and is never thrown away: a generated result the user has
   * not saved is theirs, not the page's — the recognition of the new page stands down for it too
   * (PageRecognitionService).
   */
  releaseDetectedContent(): void {
    if (this.hasUnsavedWork()) return;
    if (this.activeNode() && this.nodeSource() === 'detected') this.startNew();
  }

  /**
   * Run the metadata agent for the active tab, dropping any previous node. Returns true on
   * success so the caller can advance to the preview step. Nothing is written to the
   * history here — an entry is recorded only once a node is actually saved (see {@link save}).
   */
  async analyze(): Promise<boolean> {
    if (!this.auth.authorized()) return false;
    this.resetNodeState();
    const outcome = await this.metadataAgent.run();
    const ok = outcome.ok && !!outcome.parsed && !!outcome.source;
    this.resultPending.set(ok);
    return ok;
  }

  /**
   * Open a saved node from the history: load the live node and seed the active-node state
   * (preview + editable metadata). Navigation is driven by the caller. Throws if the node
   * cannot be fetched, leaving the state untouched.
   */
  async openFromHistory(entry: HistoryEntry): Promise<void> {
    // The live node is a bonus, not a requirement. An entry can point at a node THIS session may not
    // read: the metadata agent creates the content with its own privileges, so a guest ends up with
    // history entries the repository answers 403 for. The entry itself holds the metadata that was
    // saved, so it stands in for the node (see {@link applyStoredEntry}).
    const node = await this.loadNode(entry.nodeId);
    if (!node) this.applyStoredEntry(entry);
    else this.applyLoadedNode(entry.nodeId, node, node.name ?? entry.title, 'chosen');
    // Keep the stored parsed result so the raw/field views and the source line show.
    this.metadataAgent.restore({
      ok: true,
      parsed: entry.parsed,
      source: { url: entry.url, title: entry.title, favIconUrl: entry.favIconUrl }
    });
  }

  /**
   * Open a live node by id — same as {@link openFromHistory}, but for an externally received
   * node (an OnlyOffice preview or a freshly created document) where no agent result exists.
   * The node is recorded in the history so it can be reopened later.
   */
  async openNode(nodeId: string, source: NodeSource = 'chosen'): Promise<void> {
    const node = await this.repositoryNodes.get(nodeId);
    const name = node.name ?? nodeId;
    this.applyLoadedNode(nodeId, node, name, source);
    // No agent result for an externally received node; the raw/field views hide. Its parsed
    // view is derived from the node's own properties instead.
    this.metadataAgent.reset();
    const parsed = this.metadataAgent.parse(node.properties as Record<string, unknown>);
    await this.history.add({
      nodeId,
      url: this.activeNode()?.link ?? '',
      title: name,
      fieldsExtracted: parsed.fieldsExtracted,
      fieldsTotal: parsed.fieldsTotal,
      parsed
    });
  }

  /**
   * Take a node back up that the panel was working on before the page changed
   * (see SessionResumeService). Nothing is written to the history — the node is already in it, and
   * this is the same content continuing, not a new one being opened.
   *
   * Tolerates a node this session may not read, exactly like {@link openFromHistory}: the stored
   * entry stands in for it.
   */
  async resumeNode(nodeId: string, source: NodeSource): Promise<void> {
    const node = await this.loadNode(nodeId);
    if (node) {
      this.applyLoadedNode(nodeId, node, node.name ?? nodeId, source);
      this.metadataAgent.reset();
      return;
    }
    const entry = this.history.entries().find((candidate) => candidate.nodeId === nodeId);
    if (!entry) return;
    this.applyStoredEntry(entry);
    this.nodeSource.set(source);
    this.metadataAgent.restore({
      ok: true,
      parsed: entry.parsed,
      source: { url: entry.url, title: entry.title, favIconUrl: entry.favIconUrl }
    });
  }

  /**
   * Adopt a node that turned up on its own as the active node, so the app works on it from the
   * start (preview, metadata, collections all target it). Two callers hand one over, both about the
   * page that is open rather than about a choice the user made:
   *
   * - the document the host page has open (OnlyOfficeDocumentService, which already loaded it);
   * - the content the repository already holds for this page's URL, or the one a repository page
   *   shows (PageRecognitionService — see also {@link adoptDetectedNodeId}).
   *
   * Unlike {@link openNode} nothing is written to the history — the user did not pick this node,
   * it is simply what happens to be open. Ignored once anything else is loaded or unsaved, so a
   * late arrival (the identity is often known only after login) never clobbers the user's work.
   */
  adoptDetectedNode(node: Node): void {
    if (this.activeNode() || this.hasUnsavedWork()) return;
    // Name only when really known, never the node id as a stand-in — see {@link ActiveNode}.
    this.applyLoadedNode(node.ref.id, node, node.name ?? null, 'detected');
    // No agent result for a node we merely found open; its parsed view comes from the node's own
    // properties instead.
    this.metadataAgent.reset();
    // A node that arrives as part of *another* answer can come without its properties (the
    // duplicate list of getWebsiteInformation). Then it is loaded once, so the metadata editor
    // opens on the stored values instead of on nothing.
    if (!node.properties) void this.hydrateActiveNode(node.ref.id);
  }

  /**
   * Adopt a node an open page identifies by **id** — what a repository page does, naming the content
   * it shows in its own URL (see PageRecognitionService). Answers whether it became the content.
   *
   * The node is loaded first: an id alone is not a content, and the guard is checked before that too,
   * so a page the panel has already moved on from costs no request. A node the session may not read
   * is simply not adopted — the page says what it shows, not what this session is allowed to see.
   */
  async adoptDetectedNodeId(nodeId: string): Promise<boolean> {
    if (this.activeNode() || this.hasUnsavedWork()) return false;
    const node = await this.loadNode(nodeId);
    if (!node) return false;
    this.adoptDetectedNode(node);
    return this.activeNode()?.nodeId === nodeId;
  }

  /** Re-seed preview and editor from the fully loaded node; a no-op if the flow moved on since. */
  private async hydrateActiveNode(nodeId: string): Promise<void> {
    const node = await this.loadNode(nodeId);
    if (!node || this.activeNode()?.nodeId !== nodeId) return;
    this.previewNode.set(node);
    this.nodeMetadata.set(node.properties as MdsValues);
  }

  /**
   * Save the metadata: create the node the first time, otherwise update it in place. Returns
   * true on success so the caller can offer the next step.
   *
   * A freshly curated content takes a different route while the additional web component is
   * enabled — see {@link saveThroughAgent}.
   */
  async save(values: MdsValues): Promise<boolean> {
    if (!this.auth.authorized()) return false;
    // What other steps recorded goes underneath, so a property the editor carries too is the
    // editor's: it is the metadata's own authority, and it was seeded with the recorded values
    // anyway (see editorMetadata). A property it does not carry survives from where it was set.
    //
    // Between the two, what the editor handed over on its way out ({@link hold}): it IS the editor's
    // word, so it outranks the other steps — but only until an editor that is open right now says
    // otherwise, which is what `values` is when the save comes from one.
    values = { ...this.recordedValues(), ...this.heldValues(), ...values };
    // With the additional web component every save goes through the agent's upload — not just the
    // first one. The nodes it writes belong to the agent's own privileges, so the session the panel
    // runs under (a guest) may neither read nor edit them: an update in place is not available for
    // them, and a second save can only be another upload. See {@link saveThroughAgent}.
    if (this.additionalWebComponent.enabled()) return this.saveThroughAgent(values);
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const existing = this.activeNode();
      // Pass the current name so an update never renames the node (generated metadata carries no
      // `cm:name`). An unknown name is passed on as such — update() then sends none at all.
      const saved = existing
        ? await this.repositoryNodes.update(existing.nodeId, values, existing.name ?? undefined)
        : await this.repositoryNodes.createInInbox(values);
      this.setActiveNode(saved.nodeId, saved.name);
      this.resultPending.set(false);
      this.saved.set(true);
      // Written now, so the node's own properties are what the steps read back from here on.
      this.recordedValues.set({});
      this.heldValues.set({});
      await this.writePendingQuality(saved.nodeId);
      // Before the reload below, so the node comes back already carrying it.
      await this.writePendingPreview(saved.nodeId);
      // Load the full hydrated node once: its properties re-seed the editor (so re-editing
      // uses the stored values) and the node itself feeds the preview.
      try {
        const node = await this.repositoryNodes.get(saved.nodeId);
        this.previewNode.set(node);
        this.nodeMetadata.set(node.properties as MdsValues);
      } catch {
        /* keep editor/preview as-is if the reload fails */
      }
      await this.recordSaved(saved);
      return true;
    } catch (cause: unknown) {
      this.saveError.set(errorMessage(cause));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Save through the metadata agent's own upload instead of writing the node ourselves. That is the
   * save belonging to the WLO canvas, which is the editor while the additional web component is
   * enabled: the agent creates the node, checks for duplicates and starts the editorial workflow —
   * a plain node create does none of that.
   *
   * `/upload` only ever CREATES: it takes no node id, and the nodes it writes are the agent's, not
   * the panel session's. So a second save cannot update what the first one wrote — it uploads
   * again and produces a NEW node, which then becomes the content the flow works on. The footer
   * says so ("Erneut speichern", see ActionBarService).
   */
  private async saveThroughAgent(values: MdsValues): Promise<boolean> {
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const lastRun = this.metadataAgent.lastRun();
      const outcome = await this.metadataUpload.upload(
        values,
        lastRun?.parsed?.raw ?? null,
        lastRun?.source?.url,
      );
      if (!outcome.ok) {
        this.saveError.set(outcome.error ?? 'Upload fehlgeschlagen.');
        return false;
      }
      this.resultPending.set(false);
      this.saved.set(true);
      // Uploaded with the rest of the values, so they are the node's metadata from here on.
      this.recordedValues.set({});
      this.heldValues.set({});
      // The preview step's picture is dropped rather than written here: the agent creates the node
      // with its own privileges, so the panel session (a guest) may not upload a preview to it. What
      // the page itself offers the agent already has — `preview_image_url` travelled in the payload.
      this.pendingPreview.set(null);
      if (outcome.node?.nodeId) {
        await this.applyUploadedNode(outcome.node, values);
        await this.writePendingQuality(outcome.node.nodeId);
      }
      return true;
    } catch (cause: unknown) {
      this.saveError.set(errorMessage(cause));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Take the uploaded content over into the flow **from the endpoint's own answer**, without
   * loading the node.
   *
   * The node is deliberately not fetched back: the agent creates it with its own privileges, so the
   * session the panel runs under (a guest — which is the normal case with the additional web
   * component) is not allowed to read it. `/upload` already reports everything the following steps
   * need, so its `node` is treated as the node: its id identifies it, its `repositoryUrl` is the
   * link out, and the values just committed *are* its metadata — they are what was written.
   */
  private async applyUploadedNode(uploaded: UploadedNode, values: MdsValues): Promise<void> {
    const nodeId = uploaded.nodeId!;
    // A re-upload produces a DIFFERENT node (see saveThroughAgent), and what the previous one was
    // assigned to says nothing about this one — so the assignments start over with it.
    if (this.activeNode() && this.activeNode()!.nodeId !== nodeId) {
      this.assignedCollections.set([]);
      this.assignError.set(null);
    }
    this.activeNode.set({
      nodeId,
      // The agent's title, never the id — see {@link ActiveNode}.
      name: uploaded.title ?? null,
      link: uploaded.repositoryUrl ?? renderLink(this.auth.repositoryUrl(), nodeId)
    });
    // The committed values, since there are no stored properties to read: the editor keeps showing
    // exactly what was saved, and the preview and the usages element get a node to work on.
    this.nodeMetadata.set(values);
    this.previewNode.set(toPartialNode(nodeId, uploaded, values));
    // The user curated and saved this one, so it belongs to the flow they started.
    this.nodeSource.set('chosen');
    await this.recordSaved({ nodeId, name: uploaded.title ?? nodeId });
  }

  /**
   * Seed the flow from a stored history entry alone, for a node the repository will not hand back
   * (see {@link openFromHistory}). The entry's parsed metadata is what was saved to that node, so it
   * serves as its properties — the same substitution {@link applyUploadedNode} makes.
   */
  private applyStoredEntry(entry: HistoryEntry): void {
    const values = (entry.parsed?.raw ?? {}) as MdsValues;
    this.resetNodeState();
    this.setActiveNode(entry.nodeId, entry.title || null);
    this.nodeSource.set('chosen');
    this.nodeMetadata.set(values);
    this.previewNode.set(
      toPartialNode(entry.nodeId, { nodeId: entry.nodeId, title: entry.title }, values),
    );
  }

  /** Load a node for display purposes; `null` when the repository will not hand it back. */
  private async loadNode(nodeId: string): Promise<Node | null> {
    try {
      return await this.repositoryNodes.get(nodeId);
    } catch {
      return null;
    }
  }

  /** Add the active node to the given collection(s). */
  async assignToCollections(collections: readonly Collection[]): Promise<void> {
    const node = this.activeNode();
    if (!node || !this.auth.authorized() || !collections.length) return;
    this.assigning.set(true);
    this.assignError.set(null);
    try {
      for (const collection of collections) {
        await firstValueFrom(
          this.collections.addToCollection({
            repository: HOME_REPOSITORY,
            collection: collection.id,
            node: node.nodeId
          })
        );
        // Track it once, avoiding duplicates on repeated inserts.
        this.assignedCollections.update((list) =>
          list.some((assigned) => assigned.id === collection.id) ? list : [...list, collection]
        );
      }
    } catch (cause: unknown) {
      this.assignError.set(errorMessage(cause));
    } finally {
      this.assigning.set(false);
    }
  }

  /** Record a saved node in the history (only saved nodes are kept there). */
  private async recordSaved(saved: NodeSummary): Promise<void> {
    const lastRun = this.metadataAgent.lastRun();
    const parsed = lastRun?.parsed;
    if (!parsed) return;
    await this.history.add({
      nodeId: saved.nodeId,
      url: lastRun?.source?.url ?? '',
      title: lastRun?.source?.title ?? saved.name,
      favIconUrl: lastRun?.source?.favIconUrl,
      fieldsExtracted: parsed.fieldsExtracted,
      fieldsTotal: parsed.fieldsTotal,
      parsed
    });
  }

  /** Reset the state and seed node, preview and editor metadata from a hydrated node. */
  private applyLoadedNode(
    nodeId: string,
    node: Node,
    name: string | null,
    source: NodeSource,
  ): void {
    this.resetNodeState();
    this.setActiveNode(nodeId, name);
    this.nodeSource.set(source);
    this.previewNode.set(node);
    this.nodeMetadata.set(node.properties as MdsValues);
  }

  /** Hand a confirmation given before the save on to the node the save produced. */
  private async writePendingQuality(nodeId: string): Promise<void> {
    if (!this.qualityPending) return;
    this.qualityPending = false;
    await this.writeQualityStatus(nodeId);
  }

  /**
   * Record the confirmed quality on the node. A failure is reported rather than thrown: it comes
   * after the metadata was written, and losing that save over the status would be the worse outcome
   * — the content is saved, only its confirmation did not get through.
   */
  private async writeQualityStatus(nodeId: string): Promise<void> {
    try {
      await this.repositoryNodes.addWorkflowStatus(
        nodeId,
        WorkflowStatus.ELEMENT_LEGALLY_APPROVED
      );
    } catch (cause: unknown) {
      this.quality.set(false);
      this.qualityError.set('Die Qualität konnte nicht bestätigt werden: ' + errorMessage(cause));
    }
  }

  private setActiveNode(nodeId: string, name: string | null): void {
    this.activeNode.set({ nodeId, name, link: renderLink(this.auth.repositoryUrl(), nodeId) });
  }

  private resetNodeState(): void {
    this.resultPending.set(false);
    this.draftValues.set(null);
    this.recordedValues.set({});
    this.heldValues.set({});
    this.quality.set(false);
    this.qualityError.set(null);
    this.qualityPending = false;
    this.pendingPreview.set(null);
    this.saved.set(false);
    this.activeNode.set(null);
    this.nodeSource.set(null);
    this.nodeMetadata.set(null);
    this.previewNode.set(null);
    this.saveError.set(null);
    this.assignError.set(null);
    this.assignedCollections.set([]);
    this.extractionUrl.set(null);
  }
}
