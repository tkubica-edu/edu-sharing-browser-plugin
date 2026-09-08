import { signal } from '@angular/core';
import { vi } from 'vitest';

import { DevModeService, GENERATE_FIXTURES } from '../../app/services/dev-mode.service';

/**
 * `DevModeService` as its dependents use it: the switch they branch on, plus the two ways a faked call
 * settles. Both answer at once rather than after the real service's latency — what a spec is about is
 * which of the two a call took, not how long the panel waits to look busy.
 *
 * The settings read it through a second surface — what was chosen and what is written into its fields,
 * each with the setter that takes it over. `changedSettings` is stated rather than derived: which value
 * counts as untouched is the real service's knowledge, and a fake that recomputed it would move that
 * knowledge into the specs that read the count.
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
    generate: signal(GENERATE_FIXTURES[0].id),
    generateFixtures: GENERATE_FIXTURES,
    collectionId: signal(''),
    nodeId: signal(''),
    skipWrites: signal(false),
    changedSettings: signal(0),
    answer: answer as unknown as DevModeService['answer'],
    fail: vi.fn((label: string, error: Error): Promise<never> => {
      faked.push(label);
      return Promise.reject(error);
    }),
    setEnabled: vi.fn((enabled: boolean): Promise<void> => {
      fake.enabled.set(enabled);
      return Promise.resolve();
    }),
    setGenerate: vi.fn((id: string): Promise<void> => {
      fake.generate.set(id);
      return Promise.resolve();
    }),
    setCollectionId: vi.fn((id: string): Promise<void> => {
      fake.collectionId.set(id);
      return Promise.resolve();
    }),
    setNodeId: vi.fn((id: string): Promise<void> => {
      fake.nodeId.set(id);
      return Promise.resolve();
    }),
    setSkipWrites: vi.fn((skip: boolean): Promise<void> => {
      fake.skipWrites.set(skip);
      return Promise.resolve();
    }),
  } satisfies Partial<DevModeService>;

  /** The run stands in for this node, so a step working off one has a subject without a save. */
  function standsInForNode(nodeId: string): void {
    fake.fakedNodeId.set(nodeId);
  }

  /** The mode is on, and stands away from the defaults by as much as a spec says. */
  function faking(changed = 1): void {
    fake.enabled.set(true);
    fake.changedSettings.set(changed);
  }

  return { fake, faked, answer, standsInForNode, faking };
}

export type DevModeFake = ReturnType<typeof fakeDevMode>;
