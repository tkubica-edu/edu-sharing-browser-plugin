import { vi } from 'vitest';

import { MdsValues } from '../../app/util/mds-values';
import {
  NodeWriteOutcome,
  NodeWriteService,
  NodeWriteSteps,
} from '../../app/services/node-write.service';

/**
 * `NodeWriteService` — the agent's `POST /nodes`, the one way a session that is not the user's own gets
 * a content into the repository. Answers with a written node by default; the knobs are the three ways
 * the endpoint reports a partial success, each of which the flow treats differently.
 */
export function fakeNodeWrite(nodeId = 'agent-node-1') {
  let outcome: NodeWriteOutcome = {
    ok: true,
    created: true,
    node: { nodeId, title: null, description: null } as NodeWriteOutcome['node'],
    nodeFull: null,
  };

  const fake = {
    write: vi.fn(
      (
        _values: MdsValues,
        _payload: Record<string, unknown> | null,
        _nodeId: string | null,
        _steps?: NodeWriteSteps,
      ): Promise<NodeWriteOutcome> => Promise.resolve(outcome),
    ),
  } satisfies Partial<NodeWriteService>;

  /** The endpoint wrote the content, and reported whatever else the case is about. */
  function writes(overrides: Partial<NodeWriteOutcome> = {}): void {
    outcome = { ...outcome, ...overrides };
  }

  /** It refused the write outright: nothing was written at all. */
  function refuses(error: string): void {
    outcome = { ok: false, error };
  }

  return { fake, writes, refuses };
}

export type NodeWriteFake = ReturnType<typeof fakeNodeWrite>;
