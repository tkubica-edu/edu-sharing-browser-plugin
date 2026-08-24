import { computed, signal } from '@angular/core';
import { Node } from 'ngx-edu-sharing-api';
import { vi } from 'vitest';

import { ActiveNode, CurationService } from '../../app/services/curation.service';
import { HistoryEntry } from '../../app/services/history.service';

/** A minimal `ActiveNode`, for the tests that only need one to exist. */
export function anActiveNode(nodeId = 'node-1'): ActiveNode {
  return { nodeId, name: null, link: `https://repo.example/components/render/${nodeId}` };
}

/**
 * `CurationService` reduced to the state its dependents read and the adoptions they trigger. The real
 * one is 1595 lines and owns the whole write path; nothing in this round tests that, so the fake
 * carries the signals as writable ones — a spec sets `activeNode`/`hasUnsavedWork` to put the panel
 * into the state whose branch it is after.
 *
 * The three `adopt*` spies answer `true` by default, since „the content was taken up" is the outcome a
 * caller's happy path is written for; a spec that needs the refusal overrides the resolved value.
 */
export function fakeCuration() {
  const activeNode = signal<ActiveNode | null>(null);
  const nodeDetected = signal(false);

  const fake = {
    activeNode,
    hasDetectedNode: computed(() => activeNode() !== null && nodeDetected()),
    hasUnsavedWork: signal(false),
    hasEditableMetadata: signal(false),
    hasCuratedResult: signal(false),
    qualityCriteriaMet: signal(false),
    agentEditWindowClosed: signal(false),
    saving: signal(false),
    assigning: signal(false),
    releaseDetectedContent: vi.fn(),
    adoptDetectedNode: vi.fn((_node: Node): void => undefined),
    adoptDetectedNodeId: vi.fn((_nodeId: string): Promise<boolean> => Promise.resolve(true)),
    adoptRememberedNode: vi.fn((_entry: HistoryEntry): Promise<boolean> => Promise.resolve(true)),
  } satisfies Partial<CurationService>;

  /** Put a node in place as one that arrived on its own, which is what `hasDetectedNode` reports. */
  function detect(nodeId = 'node-1'): void {
    activeNode.set(anActiveNode(nodeId));
    nodeDetected.set(true);
  }

  return { fake, detect };
}

export type CurationFake = ReturnType<typeof fakeCuration>;
