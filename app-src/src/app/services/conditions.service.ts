import { Injectable, computed, inject, signal } from '@angular/core';

import { Conditions } from '../model/navigation';
import { AuthService } from './auth.service';
import { CurationService } from './curation.service';
import { DebugService } from './debug.service';

/** URL pattern that marks an insert host (the OnlyOffice editor) where searching applies. */
const INSERT_HOST_PATTERN = /\/src\/tools\/onlyoffice/;

/** Host of a URL, lower-cased; '' when it cannot be parsed. */
function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/** Path of a URL, lower-cased; '' when it cannot be parsed. */
function pathOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return '';
  }
}

// Raw facts about the world, exposed as signals. Holds no navigation logic: it feeds both the
// persistent status bar and every section's and tab's visibility predicate (via `snapshot`).
@Injectable({ providedIn: 'root' })
export class ConditionsService {
  private readonly auth = inject(AuthService);
  private readonly curation = inject(CurationService);
  private readonly debug = inject(DebugService);

  /** The active browser tab's URL (set by the shell on boot). */
  readonly activeUrl = signal<string | null>(null);

  /** True while the metadata editor screen is open. */
  readonly editMode = signal(false);

  // Debug mode counts as an insert host on any page: it simulates the plugin's answers, so the
  // OnlyOffice-only options must be reachable without an editor.
  readonly onlyOfficePresent = computed(
    () => this.debug.enabled() || INSERT_HOST_PATTERN.test(this.activeUrl() ?? ''),
  );

  // Edu-Sharing page: the active host matches the configured repository host, OR the path
  // contains `/edu-sharing`.
  readonly onEduSharing = computed(() => {
    const url = this.activeUrl();
    const repositoryHost = hostOf(this.auth.repositoryUrl());
    return (
      (!!repositoryHost && hostOf(url) === repositoryHost) || pathOf(url).includes('/edu-sharing')
    );
  });

  // Not the raw session flag but `authorized`: with the additional web component enabled no login
  // is required, so every option stays reachable and the login gate never appears.
  readonly loggedIn = this.auth.authorized;

  // An active node exists when a node has been created or loaded — true both for curated
  // content and for a node received from OnlyOffice / opened from the history.
  readonly hasActiveNode = computed(() => this.curation.activeNode() !== null);

  // Narrower than the above: the node arrived on its own instead of being picked — see NodeSource.
  readonly hasDetectedNode = this.curation.hasDetectedNode;

  // Editable metadata exists: an active node, or a fresh /generate result awaiting its first
  // save (the node is created on save, so the metadata option must open on a result too).
  readonly hasEditableMetadata = this.curation.hasEditableMetadata;

  /** The snapshot handed to every option's visible() predicate. */
  readonly snapshot = computed<Conditions>(() => ({
    onlyOfficePresent: this.onlyOfficePresent(),
    onEduSharing: this.onEduSharing(),
    loggedIn: this.loggedIn(),
    hasActiveNode: this.hasActiveNode(),
    hasDetectedNode: this.hasDetectedNode(),
    hasEditableMetadata: this.hasEditableMetadata(),
    editMode: this.editMode()
  }));
}
