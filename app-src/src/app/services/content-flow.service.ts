import { inject, Injectable, signal } from '@angular/core';

import { BrowserExtensionService } from './browser-extension.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';
import { NavigationService } from './navigation.service';
import { NodeConnectorService } from './node-connector.service';
import { SessionResumeService } from './session-resume.service';

/**
 * Enters the big steps of the content flow for the active node.
 *
 * The branch is the connector: a node that opens in a connector is being edited there, so editing
 * it means accompanying that editor (Bearbeitungsmodus) — everything else has nothing to edit
 * outside the panel and goes straight to the Qualitätssicherung. The check needs the repository's
 * connector list, so it is asynchronous; {@link deciding} lets the caller show that.
 */
@Injectable({ providedIn: 'root' })
export class ContentFlowService {
  private readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);
  private readonly nodeConnector = inject(NodeConnectorService);
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly conditions = inject(ConditionsService);
  private readonly sessionResume = inject(SessionResumeService);

  /** True while the connector check for {@link edit} is running. */
  readonly deciding = signal(false);

  /** "Inhalt bearbeiten": Bearbeitungsmodus when the node opens in a connector, else Qualitätssicherung. */
  async edit(): Promise<void> {
    // The hydrated node, not just the active-node summary: the filetype matching reads its
    // mimetype, properties and access.
    const node = this.curation.previewNode();
    if (!node) {
      // A generated result that has no node yet — nothing can be open in a connector.
      this.navigation.go('quality');
      return;
    }
    this.deciding.set(true);
    try {
      if (!(await this.nodeConnector.opensInConnector(node))) {
        this.navigation.go('quality');
        return;
      }
      // Editing happens in the connector, which lives on the node's own page in the repository — so
      // take the browser there. The section is set first so it is part of the state that is saved
      // and restored: the panel reopens on the new page in the Bearbeitungsmodus.
      this.navigation.go('editing');
      await this.openNodePage();
    } finally {
      this.deciding.set(false);
    }
  }

  /** "Inhaltsübersicht anzeigen": the last big step, straight from a node. */
  showOverview(): void {
    this.navigation.go('overview');
  }

  /**
   * Take the current tab to the node's page in the repository (`…/components/render/<id>`), where the
   * connector opens the content for editing — *unless the editing is already on screen*, see
   * {@link alreadyOpen}.
   *
   * The panel cannot survive that load — it is an iframe in the page — so it is *restored* instead:
   * the state is written to storage first, the background worker reopens the panel on the new page,
   * and the app picks the state back up on boot. Same tab, not a new one: editing in a window the
   * panel cannot reach would leave the two apart.
   */
  private async openNodePage(): Promise<void> {
    const node = this.curation.activeNode();
    if (!node || this.alreadyOpen(node.nodeId)) return;
    // Save BEFORE navigating: the load tears this app down without further notice. The node's page
    // goes into the state as the page it belongs to, so the panel comes back working on it — this
    // navigation is the flow continuing, not the page changing under it (see
    // SessionResumeService.nodeStillApplies).
    await this.sessionResume.save(node.link);
    await this.browserExtension.navigateTab(node.link);
  }

  /**
   * Whether the content is already open for editing on the current page — then the panel only has to
   * switch into the Bearbeitungsmodus, and replacing the page would throw away the editor the user is
   * working in (and the panel with it) to arrive where they already are.
   *
   * Two ways to tell, because a connector page does not have to name the node in its URL:
   * - the connector is on screen at all (the OnlyOffice check, which is what opening a content for
   *   editing produces);
   * - or the URL references this node — the node's own page, and the editor where it does carry it.
   */
  private alreadyOpen(nodeId: string): boolean {
    if (this.conditions.onlyOfficePresent()) return true;
    return (this.conditions.activeUrl() ?? '').includes(nodeId);
  }
}
