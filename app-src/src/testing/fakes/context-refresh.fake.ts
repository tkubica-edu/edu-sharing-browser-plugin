import { vi } from 'vitest';

import { ContextRefreshService } from '../../app/services/context-refresh.service';

/**
 * `ContextRefreshService` as its callers use it: the one call that re-answers the checks a changed setting
 * may have invalidated. What it does with them is its own spec's subject — here it only has to be visible
 * that it was asked, since a screen's whole statement is whether it asks.
 */
export function fakeContextRefresh() {
  const fake = {
    refresh: vi.fn((): Promise<void> => Promise.resolve()),
  } satisfies Partial<ContextRefreshService>;

  return { fake };
}

export type ContextRefreshFake = ReturnType<typeof fakeContextRefresh>;
