import { Injectable, computed, inject, signal } from '@angular/core';
import { CollectionServiceUnwrapped, HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { REVIEW_RECEIVER, WorkflowStatus } from '../model/workflow';
import { DRAFT_NODE_ID } from '../util/mds-node';
import { MdsValues, firstString, toMdsEditorValues } from '../util/mds-values';
import { withAgentLicense } from '../util/agent-fields';
import { toExtendedFields } from '../util/agent-payload';
import { errorMessage } from '../util/errors';
import { renderLink } from '../util/repository-links';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { AuthService } from './auth.service';
import { SavedNode } from './browser-extension.service';
import { HistoryEntry, HistoryService } from './history.service';
import { MetadataAgentService } from './metadata-agent.service';
import { NodeWriteService } from './node-write.service';
import { NodeSummary, RepositoryNodeService } from './repository-node.service';
import { QualityJudgeService } from './quality-judge.service';

/** A collection the content was added to. */
export interface Collection {
  id: string;
  name: string;
}

/**
 * An editorial group the content is forwarded to — what "An Redaktionen weiterleiten" collects (see
 * EditorialForwardScreenComponent).
 *
 * `folder` is a collection folder inside the group, where one was picked. It is then the *only* place
 * the content is added: a folder is part of its group's collection, so adding it to both would file
 * the same content twice — see {@link CurationService.editorialCollections}.
 */
export interface EditorialTarget {
  group: Collection;
  folder?: Collection;
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
 * What a save does beyond writing the values onto the node — the steps of the endpoint's own
 * pipeline the flow asks for at the step it has reached (see {@link CurationService.save}).
 *
 * Both routes state the same three, so a step of the flow means the same thing whether the agent
 * writes the node or the panel does.
 */
export interface SaveSteps {
  /**
   * The write that DESCRIBES the content — the Metadaten step, the one that carries the whole of the
   * metadata. Two things hang off it: the WLO extended fields, which state that same payload on the
   * node (see `toExtendedFields`), and the licence the form may have had no widget to report
   * (see `withAgentLicense`). Every other step writes only what it itself decided.
   */
  metadata?: boolean;
  /** Confirm the content's quality: {@link WorkflowStatus.ELEMENT_LEGALLY_APPROVED}. */
  quality?: boolean;
  /** Hand the content over to the editorial queue: {@link WorkflowStatus.TO_CHECK}. */
  review?: boolean;
}

/**
 * Assemble a stand-in {@link Node} for a content the repository was never asked about — the one the
 * metadata agent's `/nodes` wrote and described itself (see {@link CurationService.applySavedNode}).
 *
 * A real `Node` has ~30 fields; the elements fed from it read a handful (`ref.id`, `name`, `title`,
 * `mediatype`, `properties`), so only those are filled and the cast declares the rest absent. It is
 * a *repository content* (`ccm:io`) whose file is the linked web page — which is what `mediatype`
 * and `type` say, so the usages element and the preview treat it like any other such node.
 *
 * `metadataset` is stated for the same reason as on the draft: an MDS editor initialised with a node
 * resolves its set from the *node*, so a stand-in without one would resolve none at all. Which set it
 * is, is the panel's (see {@link toDraftNode}).
 */
function toPartialNode(
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
 * The node a `/nodes` write produced, as the flow's own node: the whole one the endpoint answers
 * with (`node_full`, the same shape a node load returns), which is what the steps behind the save
 * work on — the folder it lives in, the preview the repository derived for it, its aspects and
 * access are all only in there.
 *
 * The stand-in assembled from the summary is the fallback for an answer that carries no node at all
 * — see {@link toPartialNode}. Its `metadataset` is likewise only kept where the node names one: an
 * editor resolves its set from the node, and the panel's own set is the answer for a node that
 * names none (see {@link toDraftNode}).
 */
function toWrittenNode(
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
 * The metadata of a content that has just been written, as an editor is seeded from it: the payload
 * the save started from, with the values that were committed laid over it.
 *
 * Needed because the committed values are not a payload. They are what was written, so they decide
 * what a property says — but every one of them is a `string[]` (the shape the repository takes), and
 * the envelope is not among them at all. A WLO canvas seeded from them alone therefore resolves no
 * content type (it reads `metadataset`) and renders a single-valued field from a list, which leaves
 * that field empty — a saved content would show neither its title nor its description.
 *
 * So each value goes back into the shape the payload states for that property, and everything the
 * payload carries besides the values stays. A property the payload does not know keeps its list
 * shape: it comes from a step outside the editor (the quality criteria, the preview widget's name),
 * and those are lists — {@link withCanvasScalars} is what unwraps the ones a canvas insists on
 * reading as a scalar.
 */
function toSavedMetadata(
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
 * The fields the WLO canvas renders from a SCALAR value. Its field input keeps a single-valued
 * field's text in an `inputValue` of its own and derives it from the field's value — an array it
 * derives as the empty string, so such a field renders blank however filled it is, showing its
 * placeholder ("Titel der Ressource"). Multi-valued fields are unaffected: their chips are rendered
 * off the value itself, which is a list there.
 *
 * These are the single-valued fields of the metadata agent's `core.json` (everything for which
 * neither `system.multiple` nor `datatype: 'array'` holds). Core is the whole list because it is the
 * only schema a node's properties resolve: a content type is read from `metadataset`, which the
 * properties do not carry, so no content-type schema is loaded beside it.
 */
const CANVAS_SCALAR_FIELDS: readonly string[] = [
  'cclom:title',
  'cclom:general_description',
  'ccm:wwwurl',
  'preview:url',
  'cclom:general_language'
];

/**
 * Metadata as an editor is seeded from it: as it arrived, except for the fields a canvas can only
 * read as a scalar — see {@link CANVAS_SCALAR_FIELDS}.
 *
 * Applied to everything the flow's picture of the metadata is assembled from ({@link
 * CurationService.editorMetadata}), because a list reaches those fields from every direction: a
 * node's stored properties state every property as a `string[]`, and so do the values a step outside
 * the editor contributes — the preview widget answers the content's title among them, which is
 * exactly one of these fields.
 */
function withCanvasScalars(values: Record<string, unknown>): Record<string, unknown> {
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
 * The set is the one the panel itself is on (`BrowserExtensionCustomWebComponentService.metadataSet`),
 * never the `metadataset` of the agent's payload: that names the agent's own extraction template
 * (`learning_material.json`), not a set the repository knows — asking for it 404s and the step stays
 * blank.
 */
function toDraftNode(
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
  private readonly nodeWrite = inject(NodeWriteService);
  private readonly browserExtensionCustomWebComponent = inject(BrowserExtensionCustomWebComponentService);
  private readonly repositoryNodes = inject(RepositoryNodeService);
  private readonly qualityJudge = inject(QualityJudgeService);
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
  /**
   * The active node's stored metadata, fed to the metadata editor. A payload rather than a plain
   * property map: it carries the envelope an editor resolves its schema from, and states each value
   * in the shape its field has — see {@link toSavedMetadata}.
   */
  readonly nodeMetadata = signal<Record<string, unknown> | null>(null);

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

  /**
   * Why a workflow step a save asked for did not happen; null while none failed. Kept apart from
   * {@link saveError}: the metadata is written either way, so a handover that did not get through
   * is a report about the content's *state*, not a failed save.
   */
  readonly workflowError = signal<string | null>(null);

  readonly assigning = signal(false);
  readonly assignError = signal<string | null>(null);
  readonly assignedCollections = signal<readonly Collection[]>([]);

  /**
   * The editorial groups the forwarding step picked, waiting for the save (see {@link EditorialTarget}).
   *
   * State of the flow rather than something written where it is chosen, for the same reason the
   * quality criteria are ({@link recordedValues}): the step runs *before* the content has a node, and
   * there is nothing to add to a collection until the save at the end of the Qualitätsprüfung created
   * it. They are not node properties either — where a content is filed is a relation, not a field —
   * so they travel beside the values rather than in them.
   */
  private readonly editorialTargetsState = signal<readonly EditorialTarget[]>([]);
  readonly editorialTargets = this.editorialTargetsState.asReadonly();

  /**
   * Where the forwarding actually files the content: the picked folder per group, else the group's own
   * collection — one collection per group, never both (see {@link EditorialTarget}).
   */
  readonly editorialCollections = computed<readonly Collection[]>(() =>
    this.editorialTargetsState().map((target) => target.folder ?? target.group),
  );

  /**
   * The folder in the user's own storage the content is filed in — what "Persönliche Ablage" picks
   * (PersonalStorageScreenComponent). `null` means none was picked, and the content then lands in
   * the user's inbox as it always has (see RepositoryNodeService.create).
   *
   * State of the flow rather than something carried out where it is chosen, for the same reason the
   * forwarding's targets are ({@link editorialTargets}): the step runs before the content has a node,
   * and the folder is the parent that node is created in.
   */
  private readonly storageParentState = signal<Node | null>(null);
  readonly storageParent = this.storageParentState.asReadonly();

  /**
   * The collections picked in the user's own filing step — the second thing "Persönliche Ablage"
   * offers, beside the folder. Filed like the forwarding's collections and by the same save; what
   * separates them is only who they are picked for.
   */
  private readonly personalCollectionsState = signal<readonly Collection[]>([]);
  readonly personalCollections = this.personalCollectionsState.asReadonly();

  /**
   * Every collection the flow's filing steps picked, each one once: the forwarding's and the user's
   * own. The same collection can be reached from both, and a content belongs in it once.
   */
  readonly filedCollections = computed<readonly Collection[]>(() => {
    const collections = [...this.editorialCollections(), ...this.personalCollectionsState()];
    return collections.filter(
      (collection, index) => collections.findIndex((other) => other.id === collection.id) === index,
    );
  });

  /**
   * The filed collections the content is not in yet. The save works off this rather than off
   * {@link filedCollections}, so a second save does not add the content to the same collection
   * again — the flow's own steps are re-enterable, and only the first pass has anything to file.
   */
  private readonly pendingCollections = computed<readonly Collection[]>(() => {
    const assigned = this.assignedCollections();
    return this.filedCollections().filter(
      (collection) => !assigned.some((done) => done.id === collection.id),
    );
  });

  /** Take over what the forwarding step picked — see {@link editorialTargets}. */
  setEditorialTargets(targets: readonly EditorialTarget[]): void {
    this.editorialTargetsState.set([...targets]);
  }

  /** Take over the folder the user's own filing step picked — see {@link storageParent}. */
  setStorageParent(parent: Node | null): void {
    this.storageParentState.set(parent);
  }

  /** Take over the collections the user's own filing step picked — see {@link personalCollections}. */
  setPersonalCollections(collections: readonly Collection[]): void {
    this.personalCollectionsState.set([...collections]);
  }

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
   * The quality was confirmed in the Qualitätsprüfung. Kept as state of the flow rather than read
   * back from the node: the node's workflow history is not what the *step* asks about, and the
   * confirmation is the same statement whichever route wrote it — see {@link confirmQuality}.
   */
  private readonly quality = signal(false);
  readonly qualityConfirmed = this.quality.asReadonly();

  /** Why a confirmation could not be recorded; null while none failed. */
  readonly qualityError = signal<string | null>(null);

  /**
   * Whether the quality criteria allow the confirmation to be given — what the Qualität view reports
   * of its knock-out criteria (QualityCriteriaComponent.knockoutSatisfiedChange).
   *
   * Held here rather than in that view, because both things that hang off it outlive it: the footer's
   * "Qualität bestätigen", and the Metadaten sub step, which stays locked until the criteria are
   * answered. False to begin with — an unread set demands nothing yet, but neither has it allowed
   * anything.
   */
  private readonly criteriaSatisfied = signal(false);
  readonly qualityCriteriaMet = this.criteriaSatisfied.asReadonly();

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
   * The content has been written at least once — which, since the flow saves it as soon as its
   * picture and title are confirmed, is true from the preview step on. Only the *wording* of the
   * save step depends on it ("erneut speichern"): editing stays open either way, as every further
   * save updates that same node in place (see {@link save}).
   */
  readonly metadataSaved = this.saved.asReadonly();

  /**
   * No editing right now, because a save is in flight: the values have been read and are being
   * written, so changing them would silently diverge from what lands in the repository.
   */
  readonly metadataLocked = computed(() => this.saving());

  /**
   * Whether the save goes through the metadata agent's `/nodes` rather than writing the node itself
   * — the route of a session that is not the user's own (see {@link writeThroughAgent}).
   *
   * Which request is sent is all it decides: both routes create the content once and update it from
   * there on, so the flow's steps are the same either way.
   */
  readonly savesThroughAgent = computed(
    () => this.browserExtensionCustomWebComponent.enabled() && !this.auth.loggedIn(),
  );

  /**
   * A content this session read off a page: a metadata-agent run that succeeded. It stays true once
   * that content has been written to a node — the run is what the content *is*, not what is still
   * outstanding about it (see {@link hasUnsavedWork} for that question).
   */
  readonly hasCuratedResult = computed(() => this.metadataAgent.lastRun()?.ok === true);

  /** A metadata-agent result or an active node exists. */
  readonly hasEditableMetadata = computed(
    () => this.hasCuratedResult() || this.activeNode() !== null,
  );

  /**
   * A generated result that has not been written to a node yet — loading another entry would
   * discard it, so the caller confirms first. Tracked explicitly rather than derived from "no
   * active node": a result can already have its target node (a document found open) and still be
   * unsaved.
   */
  readonly hasUnsavedWork = this.resultPending.asReadonly();

  /**
   * The folder the content is to be moved into: the one the user's own filing step picked, where the
   * node is not in it already. `null` when there is nothing to move.
   *
   * A move rather than a parent, because the content is created at the *preview* step — before that
   * filing step is reached — so where it lives can no longer be decided by the create (see
   * {@link moveToStorageParent}). Only along the route that writes the node itself: the agent's own
   * inbox is where the other one puts it, and a guest may not move it out of there.
   */
  private readonly pendingStorageParent = computed<string | null>(() => {
    if (this.savesThroughAgent()) return null;
    const target = this.storageParentState()?.ref.id;
    const current = this.previewNode()?.parent?.id;
    return target && current && target !== current ? target : null;
  });

  /**
   * Whether {@link saveCollected} still has anything to do: a content without a node has to be
   * created, and one that already has a node is written again only for what the flow collected
   * since. Without this a step that was merely passed through would update the node with nothing.
   *
   * A filing that has not been carried out counts as something to do as well, even though it is no
   * *value*: the save is what files the content into its collections and into the folder picked for
   * it (see {@link save}), so a step that only picked one would otherwise be walked past without
   * ever taking effect.
   */
  readonly hasCollectedValues = computed(
    () =>
      !this.activeNode() ||
      Object.keys(this.recordedValues()).length > 0 ||
      this.pendingCollections().length > 0 ||
      this.pendingStorageParent() !== null,
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
   *
   * Stated in the shapes an editor can read, which is this one place for all of them: whatever a
   * single step contributes, what the editor is seeded with has to render — see
   * {@link withCanvasScalars}.
   */
  readonly editorMetadata = computed<Record<string, unknown> | null>(() => {
    const payload = this.metadataAgent.lastRun()?.parsed?.raw ?? null;
    // A curated content is the run's findings with what the node already holds laid over them — NOT
    // the node's properties alone. The flow saves the content as soon as its picture and title are
    // confirmed, and what it writes at that point is exactly those two: everything the run found is
    // still a proposal the user has not seen, and reading the metadata off the node would throw it
    // away before the step that shows it (see {@link createContent}).
    //
    // For a content that was not curated here the node is all there is, and it stands alone.
    const stored = this.nodeMetadata();
    const base = this.hasCuratedResult()
      ? { ...(payload ?? {}), ...(stored ?? {}) }
      : stored ?? payload;
    const recorded = this.recordedValues();
    const merged = Object.keys(recorded).length ? { ...(base ?? {}), ...recorded } : base;
    if (!merged) return null;
    const values = withCanvasScalars(merged);
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
   * 4. The screenshot the run took of the page, for a page that named no picture at all (see
   *    `PageSource.screenshot`). It shows this content and nothing else, so it outranks the icon —
   *    but it is a photograph of a rendering rather than a picture the page chose, so everything the
   *    page or the repository states about itself comes first.
   * 5. The node's type icon (`preview.isIcon`) — true of the kind of material, but not of this one,
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
    const captured = this.metadataAgent.lastRun()?.source?.screenshot;
    if (captured) return { url: captured, isIcon: false };
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
      this.browserExtensionCustomWebComponent.metadataSet(),
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
   * What other steps recorded ({@link recordValues}) is laid over the node's stored properties — for
   * a *draft* that already happened (it is built from {@link editorMetadata}), but a saved node
   * carries what the repository holds, which is not yet what the flow does. Without this the editor
   * would open on the older values and commit them back over the newer ones.
   */
  editorNode(): Node | null {
    const node = this.previewNode();
    if (!node) return this.draftNode();
    const recorded = this.recordedValues();
    if (!Object.keys(recorded).length) return node;
    return { ...node, properties: { ...node.properties, ...recorded } };
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
   * Write the content as the preview step confirmed it — the FIRST save of the flow, and the one
   * that creates the node: from here on every step edits that node rather than collecting for a
   * save at the end.
   *
   * **The picture and the title, and nothing else.** They are what this step confirmed, and each of
   * the steps behind it adds what *it* decided: the collections, the criteria, and finally the whole
   * of the generated metadata at the Metadaten step. The agent's findings are deliberately not
   * written here — until the user has seen them, they are a proposal.
   *
   * The title is the one the preview step's editor reported ({@link applyDraftValues}, which the
   * caller runs first). The picture is content rather than a property, so it travels its own way: it
   * is uploaded onto the node this creates ({@link writePendingPreview}), and along the agent's route
   * it is the `preview_image_url` its payload already carries.
   */
  createContent(): Promise<boolean> {
    const title = this.contentTitle();
    return this.save(title ? { 'cclom:title': [title] } : {});
  }

  /**
   * Write what the flow collected outside the metadata editor ({@link recordValues}) — the way on
   * out of a step that has no editor to commit: the collections it picked, the folder it chose, the
   * criteria it recorded.
   *
   * A step that collected nothing is passed without a request: the content is already written, and
   * an update with nothing in it would only add a version to it.
   */
  saveCollected(steps: SaveSteps = {}): Promise<boolean> {
    return this.hasCollectedValues() || steps.quality || steps.review
      ? this.save({}, null, steps)
      : Promise.resolve(true);
  }

  /** Take over what the Qualität view reports of its criteria — see {@link qualityCriteriaMet}. */
  reportQualityCriteria(satisfied: boolean): void {
    this.criteriaSatisfied.set(satisfied);
  }

  /**
   * Confirm the content's quality: the criteria the view recorded are written onto the node and the
   * quality workflow is started with them ({@link WorkflowStatus.ELEMENT_LEGALLY_APPROVED}).
   *
   * One save, not two: the criteria are the *reason* for the confirmation, so a node that carries
   * the status without them would state a judgement nothing supports. Both routes take them
   * together — `start_quality_workflow` runs after the metadata was written (see
   * {@link NodeWriteService}), and so does the status the panel writes itself.
   *
   * The confirmation holds only where it was actually recorded: a write that did not get through
   * leaves the statement unmade and says why ({@link qualityError}), which is what the view shows.
   */
  async confirmQuality(): Promise<void> {
    this.qualityError.set(null);
    const written = await this.save({}, null, { quality: true });
    const problem = written ? this.workflowError() : this.saveError();
    this.quality.set(!problem);
    if (problem) this.qualityError.set('Die Qualität konnte nicht bestätigt werden: ' + problem);
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

  /**
   * The picture to send along the agent's route, as its `/nodes` takes it: an address it fetches, or
   * the picture itself as a data URL (see {@link NodeWriteSteps.preview}). `null` when there is none
   * to send — the node then keeps whatever preview it has.
   *
   * The same two sources {@link writePendingPreview} writes on the other route, and in the same
   * order: a picture picked in the editor that is open right now wins over the one the preview step
   * carried over. An object URL is read out first — it names a picture inside this browser, which is
   * nowhere a service can fetch from.
   */
  private async previewToSend(): Promise<string | null> {
    const src = this.pickedPreviewSrc() ?? this.pendingPreview();
    if (!src?.startsWith('blob:')) return src;
    return await toDataUrl(src);
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
   *
   * The quality judges are set going on the way out, without being waited for: they are about the same
   * page the agent just read, and they take about a minute — a minute the user spends on the steps that
   * follow rather than in front of a spinner. Their answer is read wherever it is shown
   * (QualityJudgeService).
   */
  async analyze(): Promise<boolean> {
    if (!this.auth.authorized()) return false;
    this.resetNodeState();
    const outcome = await this.metadataAgent.run();
    const ok = outcome.ok && !!outcome.parsed && !!outcome.source;
    this.resultPending.set(ok);
    if (ok) this.judgeQuality();
    return ok;
  }

  /**
   * The page this content is about — the one that was erschlossen, not the one the browser happens to
   * show. Restored along with a content from the Verlauf, so it holds for those too.
   */
  readonly contentUrl = computed(() => this.metadataAgent.lastRun()?.source?.url ?? null);

  /**
   * Have the content's quality judged, once (see QualityJudgeService). Public so the step that *shows*
   * the judgement can ask for one as well, for a content that never came through {@link analyze}.
   *
   * What identifies the content is named here rather than in the service: the active tab is emphatically
   * not it — a content picked from the Verlauf or a document the host page has open has nothing to do
   * with the page that is on screen, and judging that page would answer about the wrong thing.
   */
  judgeQuality(): void {
    this.qualityJudge.start({
      url: this.contentUrl(),
      nodeId: this.activeNode()?.nodeId ?? null
    });
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
    this.nodeMetadata.set({ ...(node.properties ?? {}) });
  }

  /**
   * Save the content: create the node the first time, otherwise update it in place. Returns true on
   * success so the caller can offer the next step.
   *
   * The flow writes early and often — the content is created as soon as its picture and title are
   * confirmed ({@link createContent}), and every step after that edits the node it made. So this is
   * not one save at the end of a flow but the one write every step goes through, and `steps` is what
   * the step being left asks for beyond the values (see {@link SaveSteps}).
   *
   * Whatever the step, the same three things travel with it, because each of them is something a
   * step decided that has nowhere else to be carried out: the collections picked so far
   * ({@link filedCollections}), the folder picked for the content ({@link pendingStorageParent}) and
   * the picture the preview step handed over ({@link writePendingPreview}).
   *
   * A content curated in a session that is not the user's own takes a different route — see
   * {@link writeThroughAgent}.
   *
   * `payload` is the open editor's own view of what it committed (MetadataEditor.payload), where it
   * has one. It is not what gets written — `values` is — but what the content's metadata is re-read
   * from afterwards along that route, which reloads no node; see {@link toSavedMetadata}. Without one
   * the agent's result stands in, which is what the editor started from.
   */
  async save(
    values: MdsValues,
    payload: Record<string, unknown> | null = null,
    steps: SaveSteps = {},
  ): Promise<boolean> {
    if (!this.auth.authorized()) return false;
    // What other steps recorded goes underneath, so a property the editor carries too is the
    // editor's: it is the metadata's own authority, and it was seeded with the recorded values
    // anyway (see editorMetadata). A property it does not carry survives from where it was set.
    values = { ...this.recordedValues(), ...values };
    // Only on the write that describes the content, and before the branch so it holds for both
    // editors: the licence is written even where the open form had no widget to report it from (see
    // {@link withAgentLicense}). A step that writes what it decided is not one that states a licence.
    if (steps.metadata) {
      values = withAgentLicense(values, this.metadataAgent.lastRun()?.parsed?.raw ?? null);
    }
    this.saving.set(true);
    this.saveError.set(null);
    this.workflowError.set(null);
    try {
      // Only a session that is not the user's own goes through the agent: it writes with the agent's
      // privileges, which is the one way a guest session gets a content into the repository at all
      // (see {@link writeThroughAgent}). A signed-in user writes the node themselves — as their own,
      // in the folder they picked for it — even with the browser extension custom web component
      // enabled.
      return this.savesThroughAgent()
        ? await this.writeThroughAgent(values, payload, steps)
        : await this.writeToRepository(values, payload, steps);
    } catch (cause: unknown) {
      this.saveError.set(errorMessage(cause));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Write the node ourselves, through the repository's own API — the route of a signed-in user.
   *
   * What the agent's endpoint does in one request is done here in turn, in the same order: the
   * metadata, the folder ({@link moveToStorageParent}), the extended fields
   * ({@link writeExtendedData}), the workflow steps ({@link writeWorkflowSteps}) and the collections
   * ({@link assignToCollections}).
   */
  private async writeToRepository(
    values: MdsValues,
    payload: Record<string, unknown> | null,
    steps: SaveSteps,
  ): Promise<boolean> {
    const existing = this.activeNode();
    // Pass the current name so an update never renames the node (generated metadata carries no
    // `cm:name`). An unknown name is passed on as such — update() then sends none at all.
    const saved = existing
      ? await this.repositoryNodes.update(existing.nodeId, values, existing.name ?? undefined)
      // In the folder the user's own filing step picked, where it already picked one; else in the
      // inbox, and the move behind that step puts it where it belongs.
      : await this.repositoryNodes.create(values, this.storageParent()?.ref.id);
    this.setActiveNode(saved.nodeId, saved.name);
    // The user curated and saved this one, so it belongs to the flow they started rather than to the
    // page they happen to be on — which is what keeps it across a page change (SessionResumeService).
    this.nodeSource.set('chosen');
    this.resultPending.set(false);
    this.saved.set(true);
    // Written now, so the node's own properties are what the steps read back from here on.
    this.recordedValues.set({});
    if (steps.metadata) await this.writeExtendedData(saved.nodeId, values, payload);
    await this.writeWorkflowSteps(saved.nodeId, steps);
    // Before the reload below, so the node comes back already carrying it.
    await this.writePendingPreview(saved.nodeId);
    // The filing, now that there is a node to file: a collection takes a node, so this could not
    // happen at the steps that picked them (see {@link filedCollections}). A failure is reported
    // (assignError) rather than thrown — the content is written either way.
    await this.assignToCollections(this.pendingCollections());
    // After the collections, although the agent's pipeline puts the folder first: both report on
    // {@link assignError} — where the content ended up — and the assignment clears that as it starts,
    // so a move that failed would otherwise have its report wiped by the filing behind it.
    await this.moveToStorageParent(saved.nodeId);
    // Load the full hydrated node once: its properties re-seed the editor (so re-editing
    // uses the stored values) and the node itself feeds the preview.
    try {
      const node = await this.repositoryNodes.get(saved.nodeId);
      this.previewNode.set(node);
      this.nodeMetadata.set({ ...(node.properties ?? {}) });
    } catch {
      /* keep editor/preview as-is if the reload fails */
    }
    await this.recordSaved(saved);
    return true;
  }

  /**
   * Write through the metadata agent's `POST /nodes` instead of writing the node ourselves — the
   * save of a session that is not the user's own: the guest session the browser extension custom web
   * component brings may not create a node in the repository at all, and the agent writes with its
   * own privileges. It creates or updates the node, files it, writes the extended fields and runs
   * the workflow steps in one request.
   *
   * A signed-in user does not come here even with that web component enabled: they write the node
   * themselves (see {@link writeToRepository}), which is the only route that can put the content
   * where they picked it.
   *
   * The node id is what makes it an update: the first save sends none and the endpoint creates the
   * content, every later one names the node it made. The repository holds that open for two hours
   * after the node was created — a later write is refused (403) and the editorial interface takes
   * over from there, which is reported as any other refusal is.
   *
   * The filing travels *with* the request rather than being carried out afterwards: the node belongs
   * to the agent, so the panel session (a guest) may not add it to a collection either — the
   * endpoint files it itself (see {@link NodeWriteService}).
   *
   * The picture travels with it too, as the body's `preview` — an address the endpoint fetches or
   * the picture itself as a data URL. It has to go that way here: a preview is uploaded to a node
   * rather than written as a property, and this node is the agent's, so the endpoint does it.
   *
   * One thing cannot be honoured along this route, because the node is not the panel session's to
   * touch: the folder picked for the user's own storage ({@link storageParent}) — the endpoint
   * always creates in the inbox the agent is configured with.
   */
  private async writeThroughAgent(
    values: MdsValues,
    payload: Record<string, unknown> | null,
    steps: SaveSteps,
  ): Promise<boolean> {
    const source = payload ?? this.metadataAgent.lastRun()?.parsed?.raw ?? null;
    const filed = this.pendingCollections();
    const picture = await this.previewToSend();
    const outcome = await this.nodeWrite.write(values, source, this.activeNode()?.nodeId ?? null, {
      preview: picture ?? undefined,
      collections: filed.map((collection) => collection.id),
      quality: steps.quality,
      review: steps.review,
      extended: steps.metadata
    });
    if (!outcome.ok) {
      this.saveError.set(outcome.error ?? 'Speichern fehlgeschlagen.');
      return false;
    }
    this.workflowError.set(outcome.workflowError ?? null);
    // The filing travelled with the request, so its outcome is read from the same answer — the
    // route's counterpart of what assignToCollections reports on the other one.
    this.assignError.set(outcome.collectionError ?? null);
    this.resultPending.set(false);
    this.saved.set(true);
    // Written with the rest of the values, so they are the node's metadata from here on.
    this.recordedValues.set({});
    // Sent with the request, so it is off the flow's hands — a second save must not carry it again.
    if (picture) this.pendingPreview.set(null);
    // A picture the endpoint could not load or decode leaves the content written; it says so on its
    // own rather than in the answer's verdict, which is why it is only reported here.
    if (outcome.previewError) console.warn('preview not set', outcome.previewError);
    if (outcome.node?.nodeId) {
      await this.applySavedNode(outcome.node, outcome.nodeFull, values, source);
      // Filed by the endpoint, so they are recorded as done here — after applySavedNode, which
      // clears the list for a node that is not the one the previous save produced.
      this.assignedCollections.update((list) => [...list, ...filed]);
    }
    return true;
  }

  /**
   * Take the written content over into the flow **from the endpoint's own answer**, without loading
   * the node.
   *
   * The node is deliberately not fetched back: the agent writes it with its own privileges, so the
   * session the panel runs under (a guest — which is the normal case with the additional web
   * component) is not allowed to read it. `/nodes` already reports everything the following steps
   * need, so what it answers is treated as the node: its id identifies it, its `repositoryUrl` is
   * the link out, and the node it read back stands for the node itself (see {@link toWrittenNode}).
   *
   * `payload` is the editor's own view of the committed values (else the agent result they came
   * from): the values alone are not enough to seed an editor back from, so the node's metadata is
   * assembled out of both — see {@link toSavedMetadata}.
   */
  private async applySavedNode(
    saved: SavedNode,
    full: Record<string, unknown> | null | undefined,
    values: MdsValues,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    const nodeId = saved.nodeId!;
    // A write that produced a different node than the flow was working on (it created one because
    // the previous one could no longer be edited) carries none of its predecessor's assignments —
    // so they start over with it.
    if (this.activeNode() && this.activeNode()!.nodeId !== nodeId) {
      this.assignedCollections.set([]);
      this.assignError.set(null);
    }
    this.activeNode.set({
      nodeId,
      // The name the repository holds, else the agent's title — never the id, see {@link ActiveNode}.
      name: firstString((full as { name?: string } | null)?.name) ?? saved.title ?? null,
      link: saved.repositoryUrl ?? renderLink(this.auth.repositoryUrl(), nodeId)
    });
    // The committed values, since there are no stored properties this session may read: the editor
    // keeps showing exactly what was saved. As a payload rather than as the bare value map, so an
    // editor seeded back from it renders them.
    this.nodeMetadata.set(toSavedMetadata(payload, values));
    this.previewNode.set(
      toWrittenNode(
        nodeId,
        saved,
        full,
        values,
        this.browserExtensionCustomWebComponent.metadataSet(),
      ),
    );
    // The user curated and saved this one, so it belongs to the flow they started.
    this.nodeSource.set('chosen');
    await this.recordSaved({ nodeId, name: this.activeNode()?.name ?? nodeId });
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
      toPartialNode(
        entry.nodeId,
        { nodeId: entry.nodeId, title: entry.title },
        values,
        this.browserExtensionCustomWebComponent.metadataSet(),
      ),
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
    this.nodeMetadata.set({ ...(node.properties ?? {}) });
  }

  /**
   * Write the WLO extended fields onto the saved node: the content type, the whole payload as JSON
   * and the raw text the metadata was read from (see `toExtendedFields`).
   *
   * WLO only — they are fields of the additional web component's world, and a repository without it
   * neither defines them nor has a payload to fill them from. The metadata set does not define them
   * either, which is why they are a write of their own; see
   * RepositoryNodeService.writeExtendedData.
   *
   * `payload` is the editor's own view of what it committed, the agent's last result standing in for
   * it — the same fallback the metadata is re-read along.
   *
   * A field that does not get through is reported and no more: it describes the content, it is not
   * the content, and the node the save wrote stands either way.
   */
  private async writeExtendedData(
    nodeId: string,
    values: MdsValues,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    if (!this.browserExtensionCustomWebComponent.enabled()) return;
    const source = payload ?? this.metadataAgent.lastRun()?.parsed?.raw ?? null;
    try {
      const failed = await this.repositoryNodes.writeExtendedData(
        nodeId,
        toExtendedFields(values, source),
      );
      if (failed.length) console.warn('extended fields not written', failed);
    } catch (cause: unknown) {
      console.warn('extended fields not written', errorMessage(cause));
    }
  }

  /**
   * Put the node in the folder the user's own filing step picked. A move rather than a parent for
   * the create, because that step comes *after* the content was created — see
   * {@link pendingStorageParent}, which is also what says whether there is anything to move.
   *
   * A failure is reported rather than thrown: the content is written, only not where it was to be
   * filed — and losing the save over its place would be the worse outcome.
   */
  private async moveToStorageParent(nodeId: string): Promise<void> {
    const parent = this.pendingStorageParent();
    if (!parent) return;
    try {
      await this.repositoryNodes.moveTo(nodeId, parent);
    } catch (cause: unknown) {
      this.assignError.set('Der Inhalt konnte nicht abgelegt werden: ' + errorMessage(cause));
    }
  }

  /**
   * Run the workflow steps the save asked for, each its own entry in the node's history — the
   * counterpart of the agent endpoint's two switches, in the order it runs them: the handover to the
   * editorial queue first, the release second.
   *
   * A failure is reported ({@link workflowError}) rather than thrown: it comes after the metadata was
   * written, and losing that save over a status would be the worse outcome — the content is saved,
   * only the step behind it did not get through. The step that asked for it says what that means
   * (see {@link confirmQuality}).
   */
  private async writeWorkflowSteps(nodeId: string, steps: SaveSteps): Promise<void> {
    const wanted: string[] = [];
    if (steps.review) wanted.push(WorkflowStatus.TO_CHECK);
    if (steps.quality) wanted.push(WorkflowStatus.ELEMENT_LEGALLY_APPROVED);
    for (const status of wanted) {
      try {
        await this.repositoryNodes.addWorkflowStatus(nodeId, status, '', this.receiverFor(status));
      } catch (cause: unknown) {
        this.workflowError.set(`${status}: ${errorMessage(cause)}`);
        return;
      }
    }
  }

  /** Who a workflow status is addressed to; nobody outside the WLO context — see REVIEW_RECEIVER. */
  private receiverFor(status: string): readonly string[] {
    return status === WorkflowStatus.TO_CHECK &&
      this.browserExtensionCustomWebComponent.enabled()
      ? REVIEW_RECEIVER
      : [];
  }

  private setActiveNode(nodeId: string, name: string | null): void {
    this.activeNode.set({ nodeId, name, link: renderLink(this.auth.repositoryUrl(), nodeId) });
  }

  private resetNodeState(): void {
    this.resultPending.set(false);
    this.draftValues.set(null);
    this.recordedValues.set({});
    this.quality.set(false);
    this.qualityError.set(null);
    this.workflowError.set(null);
    // A judgement is about one content; the next one starts without it rather than inheriting it.
    this.qualityJudge.reset();
    // The criteria belong to the content that is going: the next one's view reports its own.
    this.criteriaSatisfied.set(false);
    this.pendingPreview.set(null);
    this.saved.set(false);
    this.activeNode.set(null);
    this.nodeSource.set(null);
    this.nodeMetadata.set(null);
    this.previewNode.set(null);
    this.saveError.set(null);
    this.assignError.set(null);
    this.assignedCollections.set([]);
    // Where a content was to be forwarded and filed is a statement about that content; the next one
    // starts without it rather than inheriting it.
    this.editorialTargetsState.set([]);
    this.storageParentState.set(null);
    this.personalCollectionsState.set([]);
    this.extractionUrl.set(null);
  }
}
