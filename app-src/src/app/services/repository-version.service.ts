import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { AboutService } from 'ngx-edu-sharing-api';

import { errorMessage } from '../util/errors';

/**
 * The repository major versions this panel's packaged web components fit. The `edu/` bundle is built from one
 * edu-sharing frontend and speaks that release's API and element contracts, so it is only used against a
 * repository of the same major version — see {@link RepositoryVersionService.webComponentsRefused}.
 */
export const SUPPORTED_MAJOR_VERSIONS: readonly number[] = [11];

/** The supported versions as the settings name them. */
export const SUPPORTED_VERSIONS_TEXT = 'Version 11';

/** How long to wait for `/_about` before giving up on it; the answer is public and small. */
const ABOUT_TIMEOUT_MS = 8000;

/**
 * Which edu-sharing the configured repository runs, read once from `GET /_about`. Two things hang on it: the
 * settings name the version, and the packaged `edu/` bundle is only loaded where the version is one its elements
 * were built for.
 *
 * The answer is public — `/_about` needs no session — so it is asked as the panel boots, before any login.
 */
@Injectable({ providedIn: 'root' })
export class RepositoryVersionService {
  private readonly about = inject(AboutService);

  /** The repository version as `/_about` states it (`version.repository`, e.g. `"11.0"`). */
  private readonly versionState = signal<string | null>(null);
  private readonly errorState = signal<string | null>(null);
  private readonly checkedState = signal(false);

  /** The one request, kept so every caller waits on the same answer. */
  private request?: Promise<void>;

  readonly version = this.versionState.asReadonly();
  /** Why the version could not be read, or null while it was read or is still being asked for. */
  readonly error = this.errorState.asReadonly();
  /** True once the repository has answered, whether with a version or with a failure. */
  readonly checked = this.checkedState.asReadonly();

  /** The leading number of the reported version, or null where the repository named none. */
  readonly major = computed(() => {
    const version = this.versionState();
    if (!version) return null;
    const major = Number.parseInt(version.trim(), 10);
    return Number.isFinite(major) ? major : null;
  });

  /** True where the repository named a version the packaged web components were built for. */
  readonly supported = computed(() => {
    const major = this.major();
    return major !== null && SUPPORTED_MAJOR_VERSIONS.includes(major);
  });

  /**
   * Whether the `edu/` bundle is refused for this repository. A version has to have been *named* for that: a
   * repository that could not be asked, or that reports no version at all, is left to the bundle as before —
   * an unreachable `/_about` is a failed request, not the statement that this is an old edu-sharing.
   */
  readonly webComponentsRefused = computed(() => this.major() !== null && !this.supported());

  /** Ask the repository for its version, at most once. Resolves once the answer settled, either way. */
  load(): Promise<void> {
    this.request ??= this.fetch();
    return this.request;
  }

  private async fetch(): Promise<void> {
    try {
      const about = await firstValueFrom(this.about.getAbout().pipe(timeout(ABOUT_TIMEOUT_MS)));
      this.versionState.set(about?.version?.repository?.trim() || null);
    } catch (cause) {
      this.errorState.set(errorMessage(cause));
    } finally {
      this.checkedState.set(true);
    }
  }
}
