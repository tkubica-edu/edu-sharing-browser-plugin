import { signal } from '@angular/core';
import { vi } from 'vitest';

import { RepositoryVersionService } from '../../app/services/repository-version.service';

/**
 * `RepositoryVersionService` — what the repository answered about itself under `/_about`, and whether the
 * packaged edu-sharing elements are embedded against it. Unasked by default, which is the state the panel
 * boots in.
 *
 * `webComponentsRefused` is a knob rather than a derivation of the version: which versions the packaged
 * elements were built for is the real service's knowledge (see `SUPPORTED_VERSIONS_TEXT`).
 */
export function fakeRepositoryVersion() {
  const fake = {
    version: signal<string | null>(null),
    error: signal<string | null>(null),
    checked: signal(false),
    webComponentsRefused: signal(false),
    load: vi.fn((): Promise<void> => Promise.resolve()),
  } satisfies Partial<RepositoryVersionService>;

  /** The repository answered with a version the packaged elements were built for. */
  function runs(version = '11.0'): void {
    fake.version.set(version);
    fake.checked.set(true);
  }

  /** It answered with one they were not built for, so they are left unloaded. */
  function unsupported(version = '10.1'): void {
    runs(version);
    fake.webComponentsRefused.set(true);
  }

  /** It said nothing usable — asked, and either refused or silent about its version. */
  function unknown(error: string | null = null): void {
    fake.checked.set(true);
    fake.error.set(error);
  }

  return { fake, runs, unsupported, unknown };
}

export type RepositoryVersionFake = ReturnType<typeof fakeRepositoryVersion>;
