import { signal } from '@angular/core';
import { vi } from 'vitest';

import { DebugService } from '../../app/services/debug.service';

/**
 * `DebugService` as the panel reads it: whether OnlyOffice events are simulated, the node the simulated
 * document reports, and how far the mode stands away from the shipped defaults.
 *
 * `changedSettings` is stated rather than derived — which value counts as untouched is the real service's
 * knowledge, and a fake that recomputed it would move that knowledge into the specs that read the count.
 */
export function fakeDebug() {
  const fake = {
    enabled: signal(false),
    documentNodeId: signal('debug-document-node'),
    changedSettings: signal(0),
    setEnabled: vi.fn((enabled: boolean): Promise<void> => {
      fake.enabled.set(enabled);
      return Promise.resolve();
    }),
    setDocumentNodeId: vi.fn((nodeId: string): Promise<void> => {
      fake.documentNodeId.set(nodeId);
      return Promise.resolve();
    }),
    emitPreviewNode: vi.fn(),
  } satisfies Partial<DebugService>;

  /** The mode is on, and stands away from the defaults by as much as a spec says. */
  function simulating(changed = 1): void {
    fake.enabled.set(true);
    fake.changedSettings.set(changed);
  }

  return { fake, simulating };
}

export type DebugFake = ReturnType<typeof fakeDebug>;
