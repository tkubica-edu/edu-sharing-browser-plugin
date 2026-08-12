import { Injectable, computed, inject, signal } from '@angular/core';

import { Conditions } from '../model/navigation';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { AuthService } from './auth.service';
import { CurationService } from './curation.service';
import { DebugService } from './debug.service';

/**
 * URL patterns that mark an insert host — the OnlyOffice editor, where searching applies and where
 * the plugin speaks for the open document. Two of them: the editor as the repository opens it
 * (`…/eduservlet/connector`), and the standalone integration the examples use.
 *
 * Matched on the path, never on the whole URL: a page merely *about* OnlyOffice
 * (de.wikipedia.org/wiki/OnlyOffice) is a page like any other.
 */
const INSERT_HOST_PATTERNS = [/\/src\/tools\/onlyoffice/, /\/eduservlet\/connector/];

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
  private readonly webComponent = inject(BrowserExtensionCustomWebComponentService);

  /** The active browser tab's URL (set by the shell on boot). */
  readonly activeUrl = signal<string | null>(null);

  /** True while the metadata editor screen is open. */
  readonly editMode = signal(false);

  /**
   * Whether it is still open what the active page's content is. Set by PageRecognitionService and, on
   * an insert host, by the request for the host's document (see AppComponent).
   *
   * True to begin with: on boot nothing has answered yet, and only once this is false does the absence
   * of a content mean there is none.
   */
  readonly recognizingContent = signal(true);

  // Debug mode counts as an insert host on any page: it simulates the plugin's answers, so the
  // OnlyOffice-only options must be reachable without an editor.
  readonly onlyOfficePresent = computed(() => {
    if (this.debug.enabled()) return true;
    const path = pathOf(this.activeUrl());
    return !!path && INSERT_HOST_PATTERNS.some((pattern) => pattern.test(path));
  });

  // Edu-Sharing page: the active host matches the configured repository host, OR the path
  // contains `/edu-sharing`.
  readonly onEduSharing = computed(() => {
    const url = this.activeUrl();
    const repositoryHost = hostOf(this.auth.repositoryUrl());
    return (
      (!!repositoryHost && hostOf(url) === repositoryHost) || pathOf(url).includes('/edu-sharing')
    );
  });

  // Not the raw session flag but `authorized`: with the browser extension custom web component
  // enabled no login is required, so every option stays reachable and the login gate never appears.
  readonly loggedIn = this.auth.authorized;

  // The raw session flag, for the question `authorized` cannot answer: is there a login to *make*?
  readonly hasSession = this.auth.loggedIn;

  // An active node exists when a node has been created or loaded — true both for curated
  // content and for a node received from OnlyOffice / opened from the history.
  readonly hasActiveNode = computed(() => this.curation.activeNode() !== null);

  // Narrower than the above: the node arrived on its own instead of being picked — see NodeSource.
  readonly hasDetectedNode = this.curation.hasDetectedNode;

  // Editable metadata exists: an active node, or a fresh /generate result awaiting its first
  // save (the node is created on save, so the metadata option must open on a result too).
  readonly hasEditableMetadata = this.curation.hasEditableMetadata;

  // A curation that has not been saved yet — the state the preview step of "Inhalt erschließen"
  // belongs to. Narrower than the above: a saved node has editable metadata but nothing pending.
  readonly hasCuratedDraft = this.curation.hasUnsavedWork;

  // The repository config's own switch, which decides more than which editor is embedded: it is
  // also what makes the editorial forwarding a step of the flow (see the `collections` section).
  readonly browserExtensionCustomWebComponent = this.webComponent.enabled;

  // What the Qualität view reports of its criteria — the gate the Metadaten sub step sits behind.
  readonly qualityCriteriaMet = this.curation.qualityCriteriaMet;

  /** The snapshot handed to every option's visible() predicate. */
  readonly snapshot = computed<Conditions>(() => ({
    onlyOfficePresent: this.onlyOfficePresent(),
    onEduSharing: this.onEduSharing(),
    loggedIn: this.loggedIn(),
    hasSession: this.hasSession(),
    hasActiveNode: this.hasActiveNode(),
    hasDetectedNode: this.hasDetectedNode(),
    hasEditableMetadata: this.hasEditableMetadata(),
    hasCuratedDraft: this.hasCuratedDraft(),
    editMode: this.editMode(),
    recognizingContent: this.recognizingContent(),
    browserExtensionCustomWebComponent: this.browserExtensionCustomWebComponent(),
    qualityCriteriaMet: this.qualityCriteriaMet()
  }));
}
