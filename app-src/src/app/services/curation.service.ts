import { Injectable, computed, inject, signal } from '@angular/core';
import { CollectionServiceUnwrapped, HOME_REPOSITORY, Node } from 'ngx-edu-sharing-api';
import { firstValueFrom } from 'rxjs';

import { REVIEW_RECEIVER, WorkflowStatus } from '../model/workflow';
import {
  createdAtOf, fieldOrigins, isPickedPicture, previewImageOf, previewSrcOfNode, toDataUrl,
  toDraftNode, toPartialNode, toSavedMetadata, toWrittenNode, withCanvasScalars, withReadablePreview
} from '../util/curation-node';
import { MdsValues, firstString, stringValues, toMdsEditorValues } from '../util/mds-values';
import { withAgentLicense } from '../util/agent-fields';
import {
  EXTENDED_DATA_FIELD, EXTENDED_TEXT_FIELD, SOURCE_TEXT_KEY, toEnvelope, toExtendedFields
} from '../util/agent-payload';
import { errorMessage } from '../util/errors';
import { renderLink } from '../util/repository-links';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { AuthService } from './auth.service';
import { SavedNode } from './browser-extension.service';
import { HistoryEntry, HistoryService } from './history.service';
import { MetadataAgentService } from './metadata-agent.service';
import type { NavStep } from './navigation.service';
import { NodeWriteService } from './node-write.service';
import { NodeSummary, RepositoryNodeService } from './repository-node.service';
import { QualityJudgeService } from './quality-judge.service';

/** A collection the content was added to. */
export interface Collection {
  id: string;
  name: string;
}

/**
 * An editorial group the content is forwarded to. `folder` is a collection folder inside the group;
 * where one is picked it is the only place the content is added, since the folder is part of the
 * group's own collection.
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
 * How the active node became the app's content: `detected` describes the open page and lives as long
 * as that page does, `chosen` belongs to the flow the user started and is released with it.
 */
export type NodeSource = 'detected' | 'chosen';

/**
 * Reads the picture the open step's editor currently shows, as an image source (an object URL for one
 * the user picked in its preview widget, the preview URL otherwise) — see
 * {@link CurationService.registerDraftPreviewSource}.
 */
export type DraftPreviewSource = () => string | null;

/**
 * What a save does beyond writing the values — the steps of the endpoint's pipeline the flow asks for
 * at the step it has reached. Both save routes state the same three.
 */
export interface SaveSteps {
  /**
   * The write that describes the content (the Metadaten step). It carries the whole payload, and with
   * it the WLO extended fields and the licence the form may have had no widget for.
   */
  metadata?: boolean;
  /** Confirm the content's quality: {@link WorkflowStatus.ELEMENT_LEGALLY_APPROVED}. */
  quality?: boolean;
  /** Hand the content over to the editorial queue: {@link WorkflowStatus.TO_CHECK}. */
  review?: boolean;
}

/**
 * The node the app works on, plus its link into the repository UI. `name` is null while the real name
 * is unknown: it is written back as `cm:name`, so a placeholder would rename the document.
 */
export interface ActiveNode {
  nodeId: string;
  name: string | null;
  link: string;
}

/**
 * How long the metadata agent's `POST /nodes` may still edit a node after it was created. The
 * repository refuses the write afterwards, and the panel's session has no other way to write — see
 * {@link CurationService.agentEditWindowClosed}.
 */
const AGENT_EDIT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Same tag as the history's own log lines, so reading and writing it read as one story. */
const LOG_HISTORY = '[edu-sharing][history]';

/**
 * What is said in place of the repository's own refusal once that window has closed: it answers with
 * the node's id, its creation date and its age in hours, none of which names the one thing that
 * reopens the content for editing.
 */
const EDIT_WINDOW_CLOSED_TEXT =
  'Dieser Inhalt kann in dieser Sitzung nicht mehr bearbeitet werden. Melde dich an, um ihn weiter zu bearbeiten.';

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
   * whose metadata is not. The WLO canvas runs the agent on it as it mounts.
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
   * The page a content taken up from the Verlauf is still to be erschlossen from. Held until the run
   * has answered and carried across a page change (SessionResumeService), because opening such a
   * content takes the tab to it — see {@link runPendingExtraction}.
   */
  private readonly pendingExtractionState = signal<string | null>(null);
  readonly pendingExtraction = this.pendingExtractionState.asReadonly();

  /** Take the mark up again on the page the flow moved to, and act on it. */
  resumePendingExtraction(url: string): Promise<void> {
    this.pendingExtractionState.set(url);
    return this.runPendingExtraction();
  }

  /**
   * Erschließe the page the taken-up content names, so the steps behind it work on a run of their own
   * as they do in the flow that first produced this content: the entry holds what was written to the
   * node and nothing else (see {@link recordSaved}), so what the agent proposes for the fields the
   * node leaves empty, the marks that say which of them are the agent's, and the text it all was read
   * from are what this brings back. The node's own values win over all of it ({@link editorMetadata}),
   * so nothing that was saved is overwritten by a proposal.
   */
  async runPendingExtraction(): Promise<void> {
    const url = this.pendingExtractionState();
    if (!url || !this.auth.authorized() || this.metadataAgent.running()) return;
    const outcome = await this.metadataAgent.runForUrl(url, this.contentTitle());
    if (!outcome.ok) return;
    // Only once it has answered: a run cut short by the page change is picked up again on the next one.
    this.pendingExtractionState.set(null);
    // As the flow does behind its own run — the judgement is then ready by the time the step that
    // shows it is reached, and it can read the page's text off this result.
    this.judgeQuality();
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
   * The editorial groups the forwarding step picked, waiting for the save: that step runs before the
   * content has a node, and where a content is filed is a relation rather than a property.
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
   * The folder in the user's own storage the content is filed in; null leaves it in the inbox. Held
   * until the save, which is where the node it applies to comes into existence.
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
   * Held here because a curated content has no node to write them to until the save at the end.
   */
  private readonly recordedValues = signal<MdsValues>({});

  /**
   * The quality was confirmed in the Qualitätsprüfung. Kept as state of the flow rather than read
   * back from the node: the node's workflow history is not what the *step* asks about, and the
   * confirmation is the same statement whichever route wrote it — see {@link confirmQuality}.
   */
  private readonly quality = signal(false);
  readonly qualityConfirmed = this.quality.asReadonly();

  /**
   * Whether the Erschließung of the active content reached its end — the handover to the editorial queue.
   * `null` where nothing is known about it, which is every content this panel did not erschließen itself:
   * one the repository merely holds for the open page says nothing about who described it, or how far.
   */
  private readonly curationFinished = signal<boolean | null>(null);

  /**
   * The active content is one whose Erschließung was left unfinished — offered as the way to take it
   * back up (see the main menu's card). Deliberately not the negation of {@link curationFinished}: an
   * unknown state is not an unfinished one.
   */
  readonly curationUnfinished = computed(() => this.curationFinished() === false);

  /**
   * The step the active content was last worked on, as its history entry remembers it; null for a content
   * with no such record. What continues an unfinished Erschließung goes there rather than to the junction
   * — see HistoryEntry.step, and NavigationService.resumableStep for whether it can still be opened.
   */
  private readonly leftAtStepState = signal<NavStep | null>(null);
  readonly leftAtStep = this.leftAtStepState.asReadonly();

  /** Why a confirmation could not be recorded; null while none failed. */
  readonly qualityError = signal<string | null>(null);

  /**
   * Whether the quality criteria allow the confirmation to be given, as the Qualität view reports it.
   * Held here because both things hanging off it outlive that view: the footer's action and the
   * Metadaten sub step, which stays locked until the criteria are answered.
   */
  private readonly criteriaSatisfied = signal(false);
  readonly qualityCriteriaMet = this.criteriaSatisfied.asReadonly();

  /**
   * Whether a machine check on this content is still out. Exposed for the confirmation, which waits for it: the
   * checks tick criteria of their own, so a confirmation given while one is running would record an answer the
   * user never saw.
   */
  readonly qualityChecksRunning = this.qualityJudge.running;

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
   * The content has been written at least once. Only the wording of the save step depends on it —
   * editing stays open either way, as every further save updates that same node.
   */
  readonly metadataSaved = this.saved.asReadonly();

  /**
   * No editing right now, because a save is in flight: the values have been read and are being
   * written, so changing them would silently diverge from what lands in the repository.
   */
  readonly metadataLocked = computed(() => this.saving());

  /**
   * Whether the save goes through the metadata agent's `/nodes` instead of writing the node itself —
   * the route of a session that is not the user's own. It decides the request, not the flow.
   */
  readonly savesThroughAgent = computed(
    () => this.browserExtensionCustomWebComponent.enabled() && !this.auth.loggedIn(),
  );

  /**
   * Whether the active content is beyond what this session may still write: it saves through the
   * agent, and that route stops editing a node two hours after the node was created (see
   * {@link AGENT_EDIT_WINDOW_MS}). A signing-in user writes the node themselves and is not bound by
   * it, which is why this is what a login answers.
   *
   * The age is measured against the moment the content is taken up, not against a running clock: a
   * flow that started inside the window is carried through to its end rather than being cut off
   * halfway. False for a node whose creation date is unknown — the repository's refusal then still
   * reports it (see {@link agentRefusalText}).
   */
  readonly agentEditWindowClosed = computed(() => {
    if (!this.savesThroughAgent()) return false;
    const created = createdAtOf(this.previewNode());
    return created !== null && Date.now() - created > AGENT_EDIT_WINDOW_MS;
  });

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
   * A generated result that has not been written to a node yet, so the caller can confirm before
   * discarding it. Tracked explicitly: a result can have a target node and still be unsaved.
   */
  readonly hasUnsavedWork = this.resultPending.asReadonly();

  /**
   * The folder the content is to be moved into, where the filing step picked one the node is not in
   * already. A move rather than a parent, because the node is created at the preview step — before
   * that filing is reached. Only on the route that writes the node itself.
   */
  private readonly pendingStorageParent = computed<string | null>(() => {
    if (this.savesThroughAgent()) return null;
    const target = this.storageParentState()?.ref.id;
    const current = this.previewNode()?.parent?.id;
    return target && current && target !== current ? target : null;
  });

  /**
   * Whether {@link saveCollected} still has anything to do, so a step that was merely passed through
   * sends no request. A filing that has not been carried out counts too: the save is what files the
   * content into its collections and folder.
   */
  readonly hasCollectedValues = computed(
    () =>
      !this.activeNode() ||
      Object.keys(this.recordedValues()).length > 0 ||
      this.pendingCollections().length > 0 ||
      this.pendingStorageParent() !== null,
  );

  /**
   * The metadata every editor is seeded with: the node's properties where there are any, else the
   * agent payload, with what other steps recorded laid on top so the flow has one picture of the
   * content. Carries `_origins` for the whole set and states values in the shapes an editor reads.
   */
  readonly editorMetadata = computed<Record<string, unknown> | null>(() => {
    const payload = this.metadataAgent.lastRun()?.parsed?.raw ?? null;
    // A curated content is the run's findings with the node's stored properties laid over them: the
    // first save writes only picture and title, so reading the metadata off the node alone would
    // discard the findings before the step that shows them.
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
   * The content's keywords, one per entry: what was generated for it, or what its node carries where it
   * has been edited since. They describe the content in the words a repository indexes it under, which
   * is what anything asking "what is this about" works from (see CollectionRecommendationService).
   */
  readonly contentKeywords = computed<readonly string[]>(() =>
    stringValues(this.editorMetadata()?.['cclom:general_keyword']),
  );

  /**
   * The text the content's metadata was read from: the agent's payload carries it, and a node that was
   * written from such a payload keeps it as a field of its own. `''` where none is known — for a node
   * this session merely found open, nothing states what it says.
   */
  readonly contentText = computed<string>(() => {
    const metadata = this.editorMetadata();
    return (
      firstString(metadata?.[SOURCE_TEXT_KEY]) ?? firstString(metadata?.[EXTENDED_TEXT_FIELD]) ?? ''
    );
  });

  /**
   * The content's picture, ranked by how much each source says about *this* content: a picture the
   * user picked, the one the node states, the image the agent found, the page screenshot, and last
   * the node's type icon — true of the kind of material rather than of this one.
   */
  readonly contentPreview = computed<ContentPreview | null>(() => {
    const picked = this.pendingPreview();
    if (picked) return { url: picked, isIcon: false };
    const preview = this.previewNode()?.preview;
    const stated = previewSrcOfNode(preview);
    if (stated) return { url: stated, isIcon: false };
    const found =
      previewImageOf(this.editorMetadata()) ??
      previewImageOf(this.metadataAgent.lastRun()?.parsed?.raw);
    if (found) return { url: found, isIcon: false };
    const captured = this.metadataAgent.lastRun()?.source?.screenshot;
    if (captured) return { url: captured, isIcon: false };
    return preview?.url ? { url: preview.url, isIcon: true } : null;
  });

  /**
   * The stand-in node the preview step edits, since its content has no node yet; null without a
   * curated result. A method, not a signal: the MDS editor re-initialises on every `nodes` change, so
   * the caller reads it once as the step opens.
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
   * The node the Qualitätsprüfung's editor works on: the content's own, else the draft. Null leaves the
   * editor on a plain values map. A method for the same reason as {@link draftNode}; what other steps
   * recorded is laid over the stored properties, so the editor never commits the older values back.
   */
  editorNode(): Node | null {
    const node = this.previewNode();
    if (!node) return this.draftNode();
    const recorded = this.recordedValues();
    if (!Object.keys(recorded).length) return node;
    return { ...node, properties: { ...node.properties, ...recorded } };
  }

  /**
   * Take over the values the preview step's editor reports. Only remembered: feeding them back while
   * the step is open would re-seed the editor that reported them — see {@link applyDraftValues}.
   */
  reportDraftValues(values: MdsValues): void {
    this.draftValues.set(values);
  }

  /**
   * Take over properties recorded outside the metadata editor. They show up in {@link editorMetadata}
   * at once and are written by the next save. Merged per property, so two steps recording different
   * ones do not overwrite each other.
   */
  recordValues(values: MdsValues): void {
    this.recordedValues.update((recorded) => ({ ...recorded, ...values }));
  }

  /**
   * Write the content as the preview step confirmed it — the first save, and the one that creates the
   * node. Picture, title and the page the content was read off: the agent's other findings stay a
   * proposal until the user has seen them.
   */
  createContent(): Promise<boolean> {
    const title = this.contentTitle();
    const url = this.contentUrl();
    const values: MdsValues = {};
    if (title) values['cclom:title'] = [title];
    // From the very first write, although the metadata step writes it again: the repository answers
    // "this page is already in here" by this property, so a node that carries it is recognisable as
    // this page's content long before it is described (see PageRecognitionService).
    if (url) values['ccm:wwwurl'] = [url];
    return this.save(values);
  }

  /**
   * Write what the flow collected outside the metadata editor — the way on out of a step that has no
   * editor to commit. A step that collected nothing is passed without a request, which would only add
   * a version to the node.
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
   * Confirm the content's quality: the recorded criteria and the workflow status travel in one save,
   * so a node never carries the judgement without what supports it. The confirmation holds only where
   * the write got through; a refusal is reported in {@link qualityError}.
   */
  async confirmQuality(): Promise<void> {
    this.qualityError.set(null);
    const written = await this.save({}, null, { quality: true });
    const problem = written ? this.workflowError() : this.saveError();
    this.quality.set(!problem);
    // A closed editing window is not a statement about this content's quality but about what the
    // session may still write, so it is reported as it is rather than as a failed confirmation.
    if (problem) {
      this.qualityError.set(
        this.agentEditWindowClosed()
          ? problem
          : `Die Qualität konnte nicht bestätigt werden: ${problem}`,
      );
    }
  }

  /**
   * Let the open step say which picture its editor shows. Pulled rather than pushed, because the
   * native preview widget announces a picked picture through no output at all. One slot is enough:
   * only one of the two steps that register is ever mounted.
   */
  registerDraftPreviewSource(source: DraftPreviewSource): void {
    this.draftPreviewSource = source;
  }

  /** Counterpart of {@link registerDraftPreviewSource}; pairs by identity. */
  clearDraftPreviewSource(source: DraftPreviewSource): void {
    if (this.draftPreviewSource === source) this.draftPreviewSource = null;
  }

  /**
   * Take everything the preview step holds into the curated result, so the steps after it work on it.
   * The values go into the agent's payload, which *is* the flow's metadata as long as there is no
   * node; the picture is parked until there is one to write it to.
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
   * Turn what the preview widget shows into the picture to write after the save. A picked object or
   * data URL is taken as it is; anything else is the widget's scaled, cache-busted rendering of the
   * node preview, for which the original URL is used so the node gets the full picture.
   */
  private draftPreviewOf(src: string | null): string | null {
    if (!src) return null;
    return isPickedPicture(src) ? src : this.currentPreviewSrc();
  }

  /**
   * {@link draftPreviewOf}, plus reading an object URL out into a data URL: the next step's node
   * states a picked picture inline, so it has to travel as a value rather than as a reference.
   */
  private async resolveDraftPreview(src: string | null): Promise<string | null> {
    const picture = this.draftPreviewOf(src);
    if (!picture?.startsWith('blob:')) return picture;
    return (await toDataUrl(picture)) ?? picture;
  }

  /**
   * A picture the user picked in the editor that is open right now, and only that: at save time the
   * widget usually shows the node's own preview, which would be uploaded to itself on every save.
   */
  private pickedPreviewSrc(): string | null {
    const src = this.draftPreviewSource?.() ?? null;
    return src && isPickedPicture(src) ? src : null;
  }

  /**
   * Write the picture the preview step carried over onto the node that has just been saved; it could
   * not go earlier, since a preview belongs to a node. A picture picked in the open editor wins as the
   * later choice. A bonus, never a reason for the save to fail, and cleared once attempted.
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
   * The picture to send along the agent's route: an address the endpoint fetches, or the picture
   * itself as a data URL. Same two sources and order as {@link writePendingPreview}; an object URL is
   * read out first, since no service can fetch from this browser.
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
   * Release a content the user picked, now that the steps it was picked for have been left. A
   * `detected` node is kept — it describes the page that is still open. A curated result without a
   * node survives too: nothing else holds it and the user has not saved it anywhere.
   */
  releaseChosenContent(): void {
    if (this.activeNode() && this.nodeSource() !== 'detected') this.startNew();
  }

  /**
   * The mirror image: release a `detected` content whose whole statement was about the page just
   * left. For a page that changes under the panel without reloading it; a reboot needs none of this.
   * Unsaved work outranks the page change and is never thrown away.
   */
  releaseDetectedContent(): void {
    if (this.hasUnsavedWork()) return;
    if (this.activeNode() && this.nodeSource() === 'detected') this.startNew();
  }

  /**
   * Run the metadata agent for the active tab, dropping any previous node; true on success. Nothing is
   * written to the history until a node is actually saved. The quality judges are set going without
   * being waited for — they take about a minute, which the user spends on the steps that follow.
   */
  async analyze(): Promise<boolean> {
    if (!this.auth.authorized()) return false;
    this.resetNodeState();
    const outcome = await this.metadataAgent.run();
    const ok = outcome.ok && !!outcome.parsed && !!outcome.source;
    this.resultPending.set(ok);
    // A content that is being erschlossen right now is not one that was erschlossen: from here it counts
    // as unfinished until the flow hands it over (see {@link curationFinished}).
    if (ok) this.curationFinished.set(false);
    if (ok) this.judgeQuality();
    return ok;
  }

  /**
   * The page this content is about — the one that was erschlossen, not the one the browser happens to
   * show. Restored along with a content from the Verlauf, so it holds for those too.
   */
  readonly contentUrl = computed(() => this.metadataAgent.lastRun()?.source?.url ?? null);

  /**
   * Have the content's quality judged, once. Public so the step that shows the judgement can ask for
   * one too. What identifies the content is named here rather than in the service: the active tab is
   * emphatically not it — a content from the Verlauf has nothing to do with the page on screen.
   */
  judgeQuality(): void {
    this.qualityJudge.start({
      url: this.contentUrl(),
      nodeId: this.activeNode()?.nodeId ?? null
    });
  }

  /**
   * Open a saved node from the history: load the live node and seed the active-node state
   * (preview + editable metadata). Navigation is driven by the caller. `source` is how the content
   * arrived — picked from the list, or recognised for the page that is open (see
   * {@link adoptRememberedNode}).
   */
  async openFromHistory(entry: HistoryEntry, source: NodeSource = 'chosen'): Promise<void> {
    // The live node is a bonus, not a requirement, and it is only asked for where this session may
    // read it: the metadata agent creates the content with its own privileges, so a guest's read is
    // refused. The entry holds the metadata that was saved and stands in for the node in that case
    // (see {@link applyStoredEntry}).
    const node = this.auth.loggedIn() ? await this.loadNode(entry.nodeId) : null;
    console.log(
      `${LOG_HISTORY} ⬅ opening ${entry.nodeId} from the history as ${source} content`,
      node ? 'on the live node' : 'on the stored entry — the repository will not hand the node back',
    );
    if (!node) this.applyStoredEntry(entry, source);
    else this.applyLoadedNode(entry.nodeId, node, node.name ?? entry.title, source);
    this.applyStoredFlow(entry);
    // Only for an entry that carries no run: the page is erschlossen once more so the content has one.
    // Marked here and run where the panel is settled, since opening a content this way takes the tab
    // to it (see {@link runPendingExtraction}).
    this.pendingExtractionState.set(entry.run ? null : entry.url || null);
    if (!entry.run) {
      console.log(`${LOG_HISTORY} … the entry carries no run, so ${entry.url} is erschlossen again for it`);
    }
    // Keep the stored parsed result so the raw/field views and the source line show.
    this.restoreStoredMetadata(entry);
    this.metadataAgent.restore({
      ok: true,
      // An entry written before runs were kept has none; its own fields stand in for the display.
      parsed: entry.run ?? entry.parsed,
      source: { url: entry.url, title: entry.title, favIconUrl: entry.favIconUrl }
    });
    // The Qualität view reports its own reading as soon as it renders, which is the same statement —
    // this is what holds until then, and what the Metadaten view is opened by.
    this.criteriaSatisfied.set(entry.quality?.criteriaMet ?? false);
    this.quality.set(entry.quality?.confirmed ?? false);
    // An entry written before this was kept says nothing about it, and that is left as it stands: an
    // unknown state must not read as an unfinished one (see {@link curationFinished}).
    this.curationFinished.set(entry.finished ?? null);
    // Where it was left, for whatever takes the content further (see {@link leftAtStep}).
    this.leftAtStepState.set(entry.step ?? null);
  }

  /** The history's account of a node, for a node whose own properties are out of reach; else null. */
  private storedEntryFor(nodeId: string): HistoryEntry | null {
    return this.history.entries().find((entry) => entry.nodeId === nodeId) ?? null;
  }

  /**
   * Adopt the content the history holds for the open page, answering whether it became the content:
   * the recognition's counterpart of {@link adoptDetectedNodeId}, for a page this panel erschlossen
   * itself. It goes through the stored entry rather than through the node id alone, because the node
   * is often one this session may not read — the metadata agent writes with its own privileges — and
   * an entry that cannot be read is still an account of the content.
   */
  async adoptRememberedNode(entry: HistoryEntry): Promise<boolean> {
    if (this.activeNode() || this.hasUnsavedWork()) return false;
    await this.openFromHistory(entry, 'detected');
    const adopted = this.activeNode()?.nodeId === entry.nodeId;
    // Nothing takes the tab anywhere here — the page this content is about is the one that is open —
    // so the Erschließung the entry asks for is started right away.
    if (adopted) void this.runPendingExtraction();
    return adopted;
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
    console.log(
      `${LOG_HISTORY} ➡ recording the received node ${nodeId} in the history (no Erschließung behind it)`,
    );
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
   * Take a node back up that the panel was working on before the page changed. Nothing is written to
   * the history — the same content continues. Tolerates a node this session may not read, for which
   * the stored entry stands in.
   */
  async resumeNode(nodeId: string, source: NodeSource): Promise<void> {
    // The stored entry stands in wherever the node itself is out of reach, and is taken without asking
    // for a node a session that does not read nodes itself would only be refused.
    const entry = this.storedEntryFor(nodeId);
    const node = entry && !this.auth.loggedIn() ? null : await this.loadNode(nodeId);
    console.log(
      `${LOG_HISTORY} ⬅ resuming ${nodeId} after the page change;`,
      entry ? 'the history holds this content' : 'not in the history — it comes back as a bare node',
    );
    if (node) {
      this.applyLoadedNode(nodeId, node, node.name ?? nodeId, source);
      if (entry) this.applyStoredFlow(entry);
      else this.metadataAgent.reset();
      return;
    }
    if (!entry) return;
    this.applyStoredEntry(entry);
    this.nodeSource.set(source);
    this.metadataAgent.restore({
      ok: true,
      parsed: entry.parsed,
      source: { url: entry.url, title: entry.title, favIconUrl: entry.favIconUrl }
    });
    this.applyStoredFlow(entry);
  }

  /**
   * Adopt a node that turned up on its own — the host page's open document, or the content the
   * repository holds for this page. Nothing goes into the history: the user did not pick it. Ignored
   * once anything else is loaded or unsaved, so a late arrival never clobbers their work.
   */
  adoptDetectedNode(node: Node): void {
    if (this.activeNode() || this.hasUnsavedWork()) return;
    const nodeId = node.ref.id;
    // A node that arrives as part of *another* answer can come without its properties (the duplicate
    // list of getWebsiteInformation), and the metadata editor needs values. What this panel saved for
    // that node is the account of it that costs no request and is there for a node this session may
    // not read — which is the case for everything the metadata agent wrote with its own privileges.
    const remembered = node.properties ? null : this.storedEntryFor(nodeId);
    if (remembered) {
      this.adoptStoredEntry(remembered, 'detected');
      return;
    }
    // Name only when really known, never the node id as a stand-in — see {@link ActiveNode}.
    this.applyLoadedNode(nodeId, node, node.name ?? null, 'detected');
    // No agent result for a node we merely found open; its parsed view comes from the node's own
    // properties instead.
    this.metadataAgent.reset();
    // Nothing remembered and nothing stated: the node is loaded once so the editor opens on its
    // stored values instead of on nothing. Only where this session reads nodes itself.
    if (!node.properties && this.auth.loggedIn()) void this.hydrateActiveNode(nodeId);
  }

  /**
   * Adopt a node an open page identifies by id, and answer whether it became the content. The guard
   * runs before the load, so a page the panel has moved on from costs no request; a node this session
   * may not read is simply not adopted.
   */
  async adoptDetectedNodeId(nodeId: string): Promise<boolean> {
    if (this.activeNode() || this.hasUnsavedWork()) return false;
    // For a session that does not read nodes itself the stored entry comes first: it is an account of
    // the content that needs no read permission, so a node this panel wrote as a guest is adopted
    // instead of being refused. A session of the user's own works on the live node.
    const remembered = this.auth.loggedIn() ? null : this.storedEntryFor(nodeId);
    if (remembered) {
      this.adoptStoredEntry(remembered, 'detected');
      return true;
    }
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
   * Save the content: create the node the first time, update it in place afterwards — the write every
   * step goes through, with `steps` naming what the step being left asks for beyond the values. The
   * picked collections, the picked folder and the preview step's picture always travel along.
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
   * Write the node through the repository's own API — the route of a signed-in user. What the agent's
   * endpoint does in one request is done here in turn and in the same order: metadata, folder,
   * extended fields, workflow steps, collections.
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
    // The handover is the flow's last act, so it is what says the Erschließung is done — and a handover
    // that did not get through leaves it undone (see {@link curationFinished}).
    if (steps.review) this.curationFinished.set(!this.workflowError());
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
   * Write through the metadata agent's `POST /nodes`: the route of a session that may not create a node
   * itself, so the agent creates, files, describes and releases in one request. Updates are allowed for
   * two hours; the folder picked for the user's own storage cannot be honoured on this route.
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
      this.saveError.set(this.agentRefusalText(outcome.error) ?? 'Speichern fehlgeschlagen.');
      return false;
    }
    this.workflowError.set(this.agentRefusalText(outcome.workflowError));
    // As on the other route: the handover is what ends the Erschließung, and one that was refused
    // leaves it unfinished (see {@link curationFinished}).
    if (steps.review) this.curationFinished.set(!this.workflowError());
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
      await this.applySavedNode(outcome.node, outcome.nodeFull, values, source, picture);
      // Filed by the endpoint, so they are recorded as done here — after applySavedNode, which
      // clears the list for a node that is not the one the previous save produced.
      this.assignedCollections.update((list) => [...list, ...filed]);
    }
    return true;
  }

  /**
   * A refusal from the agent's route as it can be shown; null where there was none. Once the editing
   * window has closed the repository's own account of it is replaced: it names the node's id, the
   * date it was created and its age in hours, which describe a state rather than the way out of it
   * (see {@link EDIT_WINDOW_CLOSED_TEXT}). Every other refusal is passed on as it stands — it is the
   * best description there is of what went wrong.
   */
  private agentRefusalText(problem: string | null | undefined): string | null {
    if (!problem) return null;
    return this.agentEditWindowClosed() ? EDIT_WINDOW_CLOSED_TEXT : problem;
  }

  /**
   * Take the written content over from the endpoint's own answer, without loading the node: the agent
   * wrote it with its own privileges, so this session may read neither it nor its preview. `payload`
   * is the editor's view of the committed values, `picture` the one the save sent along.
   */
  private async applySavedNode(
    saved: SavedNode,
    full: Record<string, unknown> | null | undefined,
    values: MdsValues,
    payload: Record<string, unknown> | null,
    picture: string | null,
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
    // Read before the node is swapped in, since the picture the panel holds for the content is partly
    // read off the node it currently has (see contentPreview) — a save that sent none keeps showing
    // what the flow has been showing all along.
    const shown = picture ?? this.currentPreviewSrc();
    this.previewNode.set(
      withReadablePreview(
        toWrittenNode(
          nodeId,
          saved,
          full,
          values,
          this.browserExtensionCustomWebComponent.metadataSet(),
        ),
        shown,
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
  private applyStoredEntry(entry: HistoryEntry, source: NodeSource = 'chosen'): void {
    const values = (entry.parsed?.raw ?? {}) as MdsValues;
    this.resetNodeState();
    this.setActiveNode(entry.nodeId, entry.title || null);
    this.nodeSource.set(source);
    this.nodeMetadata.set(values);
    this.previewNode.set({
      ...toPartialNode(
        entry.nodeId,
        { nodeId: entry.nodeId, title: entry.title },
        values,
        this.browserExtensionCustomWebComponent.metadataSet(),
      ),
      // When the content was written, which the stand-in node itself states nowhere: the entry was
      // recorded by the save that created the node, so its age is the node's. It is what decides
      // whether a guest session may still write this content (see {@link agentEditWindowClosed}),
      // and without it every reopened content would count as editable. Saved properties that name a
      // creation date win over it.
      createdAt: firstString(values['cm:created']) ?? String(entry.timestamp),
    } as Node);
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

  /**
   * Record a saved node in the history (only saved nodes are kept there). The entry describes the
   * *node*: the properties the repository holds after the write, never the agent's proposal — a
   * generated field the flow did not write is not part of this content, and the entry stands in for
   * the node wherever this session may not read it back (see {@link applyStoredEntry}). The payload's
   * envelope travels along, since node properties carry none and an editor seeded from the entry
   * resolves its schema from it.
   */
  private async recordSaved(saved: NodeSummary): Promise<void> {
    const lastRun = this.metadataAgent.lastRun();
    const run = lastRun?.parsed;
    if (!run) {
      console.log(
        `${LOG_HISTORY} … ${saved.nodeId} saved but not recorded: no Erschließung stands behind it`,
      );
      return;
    }
    console.log(`${LOG_HISTORY} ➡ recording the save of ${saved.nodeId} in the history`);
    const parsed = this.metadataAgent.parse({
      ...toEnvelope(run.raw),
      ...storedProperties(this.previewNode())
    });
    await this.history.add({
      nodeId: saved.nodeId,
      url: lastRun?.source?.url ?? '',
      title: lastRun?.source?.title ?? saved.name,
      favIconUrl: lastRun?.source?.favIconUrl,
      // The Erschließung's own count: it is about the run this content came out of, which the saved
      // properties say nothing about.
      fieldsExtracted: run.fieldsExtracted,
      fieldsTotal: run.fieldsTotal,
      parsed,
      // Beside what was written, the run it was written from: taking this content up again then
      // starts where the flow left it instead of erschließend its page a second time.
      run,
      // How far the check had got, for the same reason: it is what the steps behind it are unlocked by.
      quality: { criteriaMet: this.criteriaSatisfied(), confirmed: this.quality() },
      // Whether this save was the one that ended the flow, so the content can be offered to be taken
      // further where it was not (see {@link curationUnfinished}).
      finished: this.curationFinished() === true
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
   * Write the WLO extended fields onto the saved node: content type, payload as JSON and the raw text
   * the metadata was read from. WLO only, and a write of its own because the metadata set does not
   * define these fields. A field that does not get through is reported and no more.
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
   * Put the node in the folder the user's filing step picked — a move, because that step comes after
   * the content was created. A failure is reported rather than thrown: the content is written, only
   * not where it was to be filed.
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
   * Run the workflow steps the save asked for, each its own entry in the node's history: the handover
   * to the editorial queue first, the release second. A failure is reported ({@link workflowError})
   * rather than thrown — it comes after the metadata was written, and the content is saved either way.
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
    // Nothing is known about the next content's Erschließung until it says so itself, and it was left
    // nowhere yet.
    this.curationFinished.set(null);
    this.leftAtStepState.set(null);
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
    // The page to erschließen belongs to the content that is going; the next one names its own.
    this.pendingExtractionState.set(null);
  }
}

/**
 * A saved node's properties as the history keeps them: everything the repository holds, minus the two
 * WLO fields that only repeat what the entry carries anyway — the whole payload as JSON and the page's
 * raw text, both of which are in the run stored beside them (see {@link toExtendedFields} and
 * {@link HistoryEntry.run}). Without this an entry would hold the content twice over.
 */
function storedProperties(node: Node | null): Record<string, unknown> {
  const properties = { ...((node?.properties ?? {}) as Record<string, unknown>) };
  delete properties[EXTENDED_DATA_FIELD];
  delete properties[EXTENDED_TEXT_FIELD];
  return properties;
}
