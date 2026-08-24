import { signal } from '@angular/core';
import { vi } from 'vitest';

import { AnnouncedPage, BrowserExtensionService } from '../../app/services/browser-extension.service';

/**
 * `BrowserExtensionService` with its extension APIs replaced: `storage.local` becomes an in-memory
 * map, and everything that would leave the panel is a spy that does nothing. It is the wrapper 15
 * services depend on, so this fake is what keeps `browser.*` out of the whole test run.
 */
export function fakeBrowserExtension() {
  /** Stands in for `storage.local`, so a `load()` can be given what a previous session wrote. */
  const storage = new Map<string, unknown>();

  // Spied separately and cast at the property below: `storageGet` is generic in its fallback, and a
  // vitest `Mock` erases the type parameter — so this is the one member the `satisfies` check cannot
  // carry. Its signature is repeated here by hand instead.
  const storageGet = vi.fn(
    (key: string, fallback: unknown): Promise<unknown> =>
      Promise.resolve(storage.has(key) ? storage.get(key) : fallback),
  );

  const fake = {
    available: true,
    announcedPage: signal<AnnouncedPage | null>(null),
    storageGet: storageGet as unknown as BrowserExtensionService['storageGet'],
    storageSet: vi.fn((key: string, value: unknown): Promise<void> => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    navigateTab: vi.fn((): Promise<void> => Promise.resolve()),
  } satisfies Partial<BrowserExtensionService>;

  return { fake, storage, storageGet };
}

export type BrowserExtensionFake = ReturnType<typeof fakeBrowserExtension>;
