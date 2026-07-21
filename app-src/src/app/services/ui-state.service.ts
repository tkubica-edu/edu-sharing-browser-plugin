import { Injectable, computed, inject, signal } from '@angular/core';

import { AuthService } from './auth.service';
import { CurationService } from './curation.service';
import { Conditions } from '../model/options';

// URL pattern that marks an insert host (e.g. the OnlyOffice editor) where "Inhalt suchen"
// applies.
const SEARCH_URL_PATTERN = /\/src\/tools\/onlyoffice/;

/** Host of a URL, lower-cased; '' when it cannot be parsed. */
function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

/** Path of a URL, lower-cased; '' when it cannot be parsed. */
function pathOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).pathname.toLowerCase(); } catch { return ''; }
}

// The CONDITIONS layer: raw facts about the world, exposed as signals/computeds. Holds no
// navigation logic. Feeds both the persistent status bar and every option's visibility
// predicate (via `conditions`).
@Injectable({ providedIn: 'root' })
export class UiStateService {
  private readonly auth = inject(AuthService);
  private readonly curation = inject(CurationService);

  /** The active browser tab's URL (set by the shell on boot). */
  readonly activeUrl = signal<string | null>(null);

  /** True while the metadata editor screen is open. */
  readonly editMode = signal(false);

  readonly onlyOfficePresent = computed(() => SEARCH_URL_PATTERN.test(this.activeUrl() ?? ''));

  // Edu-Sharing page: the active host matches the configured repository host, OR the path
  // contains `/edu-sharing`.
  readonly onEduSharing = computed(() => {
    const url = this.activeUrl();
    const repoHost = hostOf(this.auth.state().repositoryUrl);
    const hostMatch = !!repoHost && hostOf(url) === repoHost;
    return hostMatch || pathOf(url).includes('/edu-sharing');
  });

  readonly loggedIn = computed(() => this.auth.state().loggedIn);

  // An active node exists when a node has been created/loaded — true for both an
  // erschlossener Inhalt and a node received from OnlyOffice / opened from the Verlauf.
  readonly hasActiveNode = computed(() => this.curation.createdNode() !== null);

  // Editable metadata exists: an active node, or a fresh /generate result awaiting its
  // first save (the node is created on save, so Metadaten must open on a result too).
  readonly hasEditableMetadata = computed(() => this.curation.hasResult());

  // The snapshot handed to every option's visible() predicate.
  readonly conditions = computed<Conditions>(() => ({
    onlyOfficePresent: this.onlyOfficePresent(),
    onEduSharing: this.onEduSharing(),
    loggedIn: this.loggedIn(),
    hasActiveNode: this.hasActiveNode(),
    hasEditableMetadata: this.hasEditableMetadata(),
    editMode: this.editMode()
  }));

}
