import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { AboutService } from 'ngx-edu-sharing-api';

import { errorMessage } from '../util/errors';
import { normalizeVersion, packageUrl, selectBundleVersion } from '../util/edu-bundle-versions';

/** How long to wait for `/_about` before giving up on it; the answer is public and small. */
const ABOUT_TIMEOUT_MS = 8000;

/**
 * Which edu-sharing the configured repository runs, read once from `GET /_about`, and which of the
 * packaged `edu/` bundle's version folders — read from `edu/versions.json` — fits it. Two things
 * hang on the answer: the settings name the version, and `WebComponentBundleService` loads the
 * `edu/` bundle only where {@link bundleVersion} names a folder — see {@link webComponentsRefused}.
 *
 * The `/_about` answer is public — it needs no session — so it is asked as the panel boots, before
 * any login. `edu/versions.json` is a file of the extension's own package, read alongside it.
 */
@Injectable({ providedIn: 'root' })
export class RepositoryVersionService {
  private readonly about = inject(AboutService);

  /** The repository version as `/_about` states it (`version.repository`, e.g. `"11.0"`). */
  private readonly versionState = signal<string | null>(null);
  private readonly errorState = signal<string | null>(null);
  private readonly checkedState = signal(false);
  /** The edu bundle's version folders this package ships, as `edu/versions.json` lists them. */
  private readonly packagedVersionsState = signal<string[]>([]);

  /** The one request, kept so every caller waits on the same answer. */
  private request?: Promise<void>;

  readonly version = this.versionState.asReadonly();
  /** Why the version could not be read, or null while it was read or is still being asked for. */
  readonly error = this.errorState.asReadonly();
  /** True once the repository has answered, whether with a version or with a failure. */
  readonly checked = this.checkedState.asReadonly();
  readonly packagedVersions = this.packagedVersionsState.asReadonly();

  /** The packaged versions, for the notices in the settings (`"11.0"`, or `"11.0, 12.0"`). */
  readonly packagedVersionsText = computed(() => this.packagedVersionsState().join(', '));

  /** The leading number of the reported version, or null where the repository named none. */
  readonly major = computed(() => {
    const version = this.versionState();
    if (!version) return null;
    const major = Number.parseInt(version.trim(), 10);
    return Number.isFinite(major) ? major : null;
  });

  /**
   * Which of the packaged bundle's version folders to load, given what `/_about` reported and what
   * the package ships. Null only where the report named a major the package carries no folder for
   * at all — see {@link selectBundleVersion}.
   */
  readonly bundleVersion = computed(() => {
    const version = this.versionState();
    const reported = version === null ? null : normalizeVersion(version);
    return selectBundleVersion(reported, this.packagedVersionsState()).version;
  });

  /** True where {@link bundleVersion} was built for the repository's exact `major.minor`. */
  readonly bundleVersionExact = computed(() => {
    const version = this.versionState();
    const reported = version === null ? null : normalizeVersion(version);
    return selectBundleVersion(reported, this.packagedVersionsState()).exact;
  });

  /** True where the repository named a version the packaged bundle carries a folder for. */
  readonly supported = computed(() => this.major() !== null && this.bundleVersion() !== null);

  /**
   * Whether the `edu/` bundle is refused for this repository. A version has to have been *named* for that: a
   * repository that could not be asked, or that reports no version at all, is left to the bundle as before —
   * an unreachable `/_about` is a failed request, not the statement that this is an old edu-sharing.
   */
  readonly webComponentsRefused = computed(() => this.major() !== null && !this.supported());

  /** Ask the repository for its version and read the packaged bundle's versions, at most once. */
  load(): Promise<void> {
    this.request ??= this.fetch();
    return this.request;
  }

  private async fetch(): Promise<void> {
    const [about, packaged] = await Promise.allSettled([
      firstValueFrom(this.about.getAbout().pipe(timeout(ABOUT_TIMEOUT_MS))),
      this.fetchPackagedVersions(),
    ]);
    if (about.status === 'fulfilled') {
      this.versionState.set(about.value?.version?.repository?.trim() || null);
    } else {
      this.errorState.set(errorMessage(about.reason));
    }
    if (packaged.status === 'fulfilled') this.packagedVersionsState.set(packaged.value);
    this.checkedState.set(true);
  }

  /** The edu bundle's packaged version folders, from `edu/versions.json`. Empty where it cannot be read. */
  private async fetchPackagedVersions(): Promise<string[]> {
    try {
      const response = await fetch(packageUrl('edu/versions.json'));
      if (!response.ok) return [];
      const versions = await response.json();
      return Array.isArray(versions) ? versions.filter((v) => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
}
