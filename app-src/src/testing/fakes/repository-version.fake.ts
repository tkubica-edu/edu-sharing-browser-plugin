import { signal } from '@angular/core';
import { vi } from 'vitest';

import { RepositoryVersionService } from '../../app/services/repository-version.service';
import { normalizeVersion } from '../../app/util/edu-bundle-versions';

/**
 * `RepositoryVersionService` — what the repository answered about itself under `/_about`, which of the
 * packaged edu bundle's version folders fits it, and whether that folder is embedded at all. Unasked by
 * default, which is the state the panel boots in.
 *
 * `webComponentsRefused`, `bundleVersion` and `bundleVersionExact` are knobs rather than a derivation of
 * the version: which versions the package carries is the real service's knowledge (read from
 * `edu/versions.json`), not something a unit test constructs.
 */
export function fakeRepositoryVersion() {
  const fake = {
    version: signal<string | null>(null),
    error: signal<string | null>(null),
    checked: signal(false),
    packagedVersions: signal<string[]>(['11.0']),
    packagedVersionsText: signal('11.0'),
    bundleVersion: signal<string | null>(null),
    bundleVersionExact: signal(true),
    webComponentsRefused: signal(false),
    load: vi.fn((): Promise<void> => Promise.resolve()),
  } satisfies Partial<RepositoryVersionService>;

  /** The repository answered with a version the packaged bundle carries an exact folder for. */
  function runs(version = '11.0'): void {
    fake.version.set(version);
    fake.checked.set(true);
    fake.bundleVersion.set(normalizeVersion(version) ?? version);
    fake.bundleVersionExact.set(true);
  }

  /** It answered with a version no packaged folder's major covers, so the elements are left unloaded. */
  function unsupported(version = '10.1'): void {
    fake.version.set(version);
    fake.checked.set(true);
    fake.bundleVersion.set(null);
    fake.bundleVersionExact.set(false);
    fake.webComponentsRefused.set(true);
  }

  /**
   * It answered with a version of a packaged major, but not the one `bundleFolder` is the exact folder
   * for — the closest packaged folder is loaded, and the settings say so.
   */
  function inexact(version = '11.3', bundleFolder = '11.0'): void {
    fake.version.set(version);
    fake.checked.set(true);
    fake.bundleVersion.set(bundleFolder);
    fake.bundleVersionExact.set(false);
  }

  /** It said nothing usable — asked, and either refused or silent about its version. */
  function unknown(error: string | null = null): void {
    fake.checked.set(true);
    fake.error.set(error);
  }

  return { fake, runs, unsupported, inexact, unknown };
}

export type RepositoryVersionFake = ReturnType<typeof fakeRepositoryVersion>;
