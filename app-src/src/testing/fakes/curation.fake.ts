import { computed, signal } from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';
import { vi } from 'vitest';

import {
  ActiveNode,
  CurationService,
  EditorialTarget,
  NodeSource,
  SaveSteps,
} from '../../app/services/curation.service';
import { HistoryEntry } from '../../app/services/history.service';

/** A minimal `ActiveNode`, for the tests that only need one to exist. */
export function anActiveNode(nodeId = 'node-1', name: string | null = null): ActiveNode {
  return { nodeId, name, link: `https://repo.example/components/render/${nodeId}` };
}

/**
 * `CurationService` reduced to the state its dependents read and the writes they trigger. The real
 * one is 1595 lines and owns the whole write path; nothing in this round tests that, so the fake
 * carries the signals as writable ones — a spec sets `activeNode`/`hasUnsavedWork` to put the panel
 * into the state whose branch it is after.
 *
 * The three `adopt*` spies answer `true` by default, since „the content was taken up" is the outcome a
 * caller's happy path is written for; a spec that needs the refusal overrides the resolved value. The
 * writes answer the same way and for the same reason, and `confirmQuality` additionally *records* the
 * confirmation — its callers read `qualityConfirmed` back to decide whether the step may be left, so a
 * write that did not report itself would be a refusal (see {@link refuseQuality}).
 */
export function fakeCuration() {
  const activeNode = signal<ActiveNode | null>(null);
  const nodeDetected = signal(false);
  const qualityConfirmed = signal(false);
  const saving = signal(false);
  /** Where the forwarding step records what it picked; the flow carries it to the save. */
  const editorialTargets = signal<readonly EditorialTarget[]>([]);
  /** Where the content came from, and the Erschließung it still owes — what a resume carries over. */
  const nodeSource = signal<NodeSource | null>(null);
  const pendingExtraction = signal<string | null>(null);
  let qualityHolds = true;
  let resumesNode = true;

  const fake = {
    activeNode,
    // The loaded node behind the active one, which the summary above is not: what reads a mimetype,
    // an access list or a property goes through this. Null while nothing was loaded — a generated
    // result that is not a node yet.
    previewNode: signal<Node | null>(null),
    hasDetectedNode: computed(() => activeNode() !== null && nodeDetected()),
    hasUnsavedWork: signal(false),
    hasEditableMetadata: signal(false),
    hasCuratedResult: signal(false),
    qualityCriteriaMet: signal(false),
    qualityCriteriaJudged: signal(false),
    qualityMetadataEnriched: signal(false),
    qualityMetadataProposed: signal(false),
    qualityChecksRunning: signal(false),
    qualityConfirmed,
    agentEditWindowClosed: signal(false),
    running: signal(false),
    saving,
    assigning: signal(false),
    // The real one is `computed(() => this.saving())`: what a save is under way is not written twice.
    metadataLocked: computed(() => saving()),
    releaseDetectedContent: vi.fn(),
    releaseChosenContent: vi.fn(),
    adoptDetectedNode: vi.fn((_node: Node): void => undefined),
    adoptDetectedNodeId: vi.fn((_nodeId: string): Promise<boolean> => Promise.resolve(true)),
    adoptRememberedNode: vi.fn((_entry: HistoryEntry): Promise<boolean> => Promise.resolve(true)),
    analyze: vi.fn((): Promise<boolean> => Promise.resolve(true)),
    applyDraftValues: vi.fn((): Promise<void> => Promise.resolve()),
    createContent: vi.fn((): Promise<boolean> => Promise.resolve(true)),
    saveCollected: vi.fn((_steps?: SaveSteps): Promise<boolean> => Promise.resolve(true)),
    forwardToNostr: vi.fn((): Promise<boolean> => Promise.resolve(true)),
    sendToNostr: vi.fn((): Promise<boolean> => Promise.resolve(true)),
    reportMetadataEnriched: vi.fn(),
    nodeSourceOf: nodeSource,
    pendingExtraction: pendingExtraction.asReadonly(),
    resumeNode: vi.fn(async (nodeId: string, source: NodeSource): Promise<void> => {
      if (!resumesNode) return;
      activeNode.set(anActiveNode(nodeId));
      nodeSource.set(source);
    }),
    resumePendingExtraction: vi.fn((_url: string): Promise<void> => Promise.resolve()),
    contentKeywords: signal<readonly string[]>([]),
    contentText: signal(''),
    editorialTargets: editorialTargets.asReadonly(),
    setEditorialTargets: vi.fn((targets: readonly EditorialTarget[]): void => {
      editorialTargets.set(targets);
    }),
    confirmQuality: vi.fn(async (): Promise<void> => {
      if (qualityHolds) qualityConfirmed.set(true);
    }),
  } satisfies Partial<CurationService>;

  /** The node behind the content in hand, loaded — see `CurationService.previewNode`. */
  function hydrated(node: Node): void {
    fake.previewNode.set(node);
  }

  /** Put a node in place as one that arrived on its own, which is what `hasDetectedNode` reports. */
  function detect(nodeId = 'node-1'): void {
    activeNode.set(anActiveNode(nodeId));
    nodeDetected.set(true);
  }

  /** The repository refuses the confirmation: it runs and nothing is confirmed afterwards. */
  function refuseQuality(): void {
    qualityHolds = false;
  }

  /** The content is one the user chose rather than one that was found on the page. */
  function chose(nodeId = 'node-1'): void {
    activeNode.set(anActiveNode(nodeId));
    nodeSource.set('chosen');
  }

  /** The content still owes an Erschließung of this page — see `CurationService.pendingExtraction`. */
  function owesExtraction(url: string): void {
    pendingExtraction.set(url);
  }

  /** The node cannot be taken back up: it is gone, or this session may not see it. */
  function refuseResume(): void {
    resumesNode = false;
  }

  return {
    fake,
    detect,
    chose,
    hydrated,
    owesExtraction,
    refuseQuality,
    refuseResume,
    editorialTargets,
    nodeSource,
  };
}

export type CurationFake = ReturnType<typeof fakeCuration>;
