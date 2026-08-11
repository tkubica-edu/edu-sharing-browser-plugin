import { inject, Injectable, signal } from '@angular/core';

import { BrowserExtensionService } from './browser-extension.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';
import { NavigationService } from './navigation.service';
import { NodeConnectorService } from './node-connector.service';
import { OnlyOfficeDocumentService } from './onlyoffice-document.service';
import { SessionResumeService } from './session-resume.service';

/**
 * Enters the big steps of the content flow for the active node.
 *
 * The branch is the connector: a node that opens in a connector is being edited there, so editing
 * it means accompanying that editor (Bearbeitungsmodus) — everything else has nothing to edit
 * outside the panel and goes straight to the Qualitätsprüfung. The check needs the repository's
 * connector list, so it is asynchronous; {@link deciding} lets the caller show that.
 */
@Injectable({ providedIn: 'root' })
export class ContentFlowService {
  private readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);
  private readonly nodeConnector = inject(NodeConnectorService);
  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly conditions = inject(ConditionsService);
  private readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);
  private readonly sessionResume = inject(SessionResumeService);

  /** True while the connector check for {@link edit} is running. */
  readonly deciding = signal(false);

  /**
   * "Bearbeitungsmodus": that step when the node opens in a connector, else Qualitätsprüfung.
   *
   * The connector is asked for twice over: whether there is one at all decides the branch, and the
   * one there is provides the URL that *opens* the content in it — the same for every way in (a
   * freshly created document, a file from *Eigene Inhalte*, a Verlauf entry). Editing means being in
   * the editor, so that is where the tab goes; the node's own page is only the fallback for a
   * connector that reports no URL.
   */
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
      const connector = await this.nodeConnector.connectorFor(node);
      if (!connector) {
        this.navigation.go('quality');
        return;
      }
      // The section is set first so it is part of the state that is saved and restored: the panel
      // reopens on the new page in the Bearbeitungsmodus.
      this.navigation.go('editing');
      await this.openNodePage(this.nodeConnector.getConnectorUrl(node, connector));
    } finally {
      this.deciding.set(false);
    }
  }

  /**
   * "Qualitätsprüfung": the quality and metadata step, straight from a node — nothing to decide.
   * On the Qualität tab: that is what the step is entered for, and the metadata are worked on off
   * the back of it.
   */
  showQuality(): void {
    this.navigation.go('quality', { tab: 'quality-check' });
  }

  /** "An Redaktionen weiterleiten": handing the content on, ahead of the Qualitätsprüfung. */
  showEditorialForward(): void {
    this.navigation.go('editorial-forward');
  }

  /** "Persönliche Ablage": filing the content in the user's own place. */
  showPersonalStorage(): void {
    this.navigation.go('personal-storage');
  }

  /** "Inhaltsübersicht": the last big step, straight from a node — on its Vorschau tab. */
  showOverview(): void {
    this.navigation.go('overview', { tab: 'preview' });
  }

  /** "Freigabe": the sharing tab of the Inhaltsübersicht, offered as a step of its own. */
  showShare(): void {
    this.navigation.go('overview', { tab: 'share' });
  }

  /**
   * Take the current tab to where the content is edited: the connector's URL, or the node's page in
   * the repository (`…/components/render/<id>`) when there is none — *unless the editing is already
   * on screen*, see {@link alreadyOpen}.
   *
   * The panel cannot survive that load — it is an iframe in the page — so it is *restored* instead:
   * the state is written to storage first, the background worker reopens the panel on the new page,
   * and the app picks the state back up on boot. Same tab, not a new one: editing in a window the
   * panel cannot reach would leave the two apart.
   */
  private async openNodePage(connectorUrl?: string): Promise<void> {
    const node = this.curation.activeNode();
    if (!node) return;
    const target = connectorUrl || node.link;
    if (this.alreadyOpen(node.nodeId, target)) return;
    // Save BEFORE navigating: the load tears this app down without further notice. The page we are
    // about to open goes into the state as the page it belongs to, so the panel comes back working
    // on it — this navigation is the flow continuing, not the page changing under it (see
    // SessionResumeService.nodeStillApplies).
    await this.sessionResume.save(target);
    try {
      await this.browserExtension.navigateTab(target);
    } catch (cause: unknown) {
      // The page stays, so this app lives on: take the state tracking back up, which `save` switched
      // off for what it assumed was the last write of this panel.
      this.sessionResume.track();
      throw cause;
    }
  }

  /**
   * Whether the content is already open for editing on the current page — then the panel only has to
   * switch into the Bearbeitungsmodus, and replacing the page would throw away the editor the user is
   * working in (and the panel with it) to arrive where they already are.
   *
   * Two ways to tell, because the connector redirects: the page the editor ends up on is its own,
   * not the URL we navigated to.
   * - the connector on screen is showing **this** node;
   * - or the tab is already on the exact page this navigation would open.
   *
   * The connector check needs the node identity, not just the connector's presence: a page with
   * OnlyOffice on it says nothing about a *different* node — a document that was just created, or
   * one picked from *Eigene Inhalte*, whose editor is somewhere else entirely. Reading presence
   * alone as "already open" left the panel behind on the old page.
   *
   * An open document whose identity is unknown (the plugin is disabled, or its config is stale)
   * still counts as open: without knowing which node it holds, navigating away would risk throwing
   * away exactly the editor the user is working in — the mistake this check exists to prevent.
   *
   * Deliberately no "the URL mentions the node id" check: the node's *detail* page carries the id
   * too, and standing there is not being in the editor — that reading kept the user on the detail
   * page instead of taking them into the connector.
   */
  private alreadyOpen(nodeId: string, target: string): boolean {
    if (this.conditions.onlyOfficePresent()) {
      const openNodeId = this.onlyOfficeDocument.currentDocument()?.nodeId;
      if (!openNodeId || openNodeId === nodeId) return true;
    }
    return this.conditions.activeUrl() === target;
  }
}
