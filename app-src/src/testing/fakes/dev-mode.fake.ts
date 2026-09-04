import { signal } from '@angular/core';
import { vi } from 'vitest';

import { DevModeService } from '../../app/services/dev-mode.service';

/**
 * `DevModeService` as its dependents use it: the switch they branch on, plus the two ways a faked call
 * settles. Both answer at once rather than after the real service's latency — what a spec is about is
 * which of the two a call took, not how long the panel waits to look busy.
 */
export function fakeDevMode() {
  /** Every call that was answered from a fixture rather than sent, by the label it was made under. */
  const faked: string[] = [];

  // Spied separately and cast at the property below: `answer` is generic in its fixture, and a vitest
  // `Mock` erases the type parameter — the same member the `satisfies` check cannot carry that
  // `storageGet` is in `fakeBrowserExtension()`.
  const answer = vi.fn((label: string, fixture: unknown): Promise<unknown> => {
    faked.push(label);
    return Promise.resolve(structuredClone(fixture));
  });

  const fake = {
    enabled: signal(false),
    fakedCollectionId: signal(''),
    fakedNodeId: signal(''),
    writesSkipped: signal(false),
    answer: answer as unknown as DevModeService['answer'],
    fail: vi.fn((label: string, error: Error): Promise<never> => {
      faked.push(label);
      return Promise.reject(error);
    }),
  } satisfies Partial<DevModeService>;

  /** The run stands in for this node, so a step working off one has a subject without a save. */
  function standsInForNode(nodeId: string): void {
    fake.fakedNodeId.set(nodeId);
  }

  return { fake, faked, answer, standsInForNode };
}

export type DevModeFake = ReturnType<typeof fakeDevMode>;
