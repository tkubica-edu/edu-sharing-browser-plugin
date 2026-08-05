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
  private readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);
  private readonly sessionResume = inject(SessionResumeService);

  /** True while the connector check for {@link edit} is running. */
  readonly deciding = signal(false);

  /**
   * Open the active content in its connector and accompany it in the Bearbeitungsmodus. Answers
   * whether it has one — a content that opens in no connector is left where it is.
   *
   * This is what *picking* a content does, for every way in: a freshly created document, a file from
   * *Eigene Inhalte*. Opening such a content means opening its editor, so it happens right then
   * rather than one screen later — by the time the Inhaltsoptionen are on screen, the content the
   * connector holds is already open in it.
   *
   * The connector is asked for twice over: whether there is one at all decides this, and the one
   * there is provides the URL that opens the content in it. Editing means being in the editor, so
   * that is where the tab goes; the node's own page is only the fallback for a connector that
   * reports no URL.
   */
  async openInConnector(): Promise<boolean> {
    // The hydrated node, not just the active-node summary: the filetype matching reads its
    // mimetype, properties and access. A generated result that has no node yet has no connector
    // either — nothing can be open in one.
    const node = this.curation.previewNode();
    if (!node) return false;
    this.deciding.set(true);
    try {
      const connector = await this.nodeConnector.connectorFor(node);
      if (!connector) return false;
      // The section is set first so it is part of the state that is saved and restored: the panel
      // reopens on the new page in the Bearbeitungsmodus.
      this.navigation.go('editing');
      await this.openNodePage(this.nodeConnector.getConnectorUrl(node, connector));
      return true;
    } finally {
      this.deciding.set(false);
    }
  }

  /**
   * Take the content to the step it calls for: the connector's Bearbeitungsmodus when it has one,
   * else the Qualitätssicherung. For where a content *arrives* and the next step is not the user's
   * choice but the content's — a document just created through a connector is open in it.
   */
  async edit(): Promise<void> {
    if (!(await this.openInConnector())) this.navigation.go('quality');
  }

  /**
   * "Bearbeitungsmodus": accompany the editor the content is already open in — the panel step alone,
   * with no navigation of the tab. Nothing to open here: on the insert host the editor *is* the page,
   * and a content picked elsewhere was opened in its connector when it was picked (see
   * {@link openInConnector}).
   */
  enterEditing(): void {
    this.navigation.go('editing');
  }

  /** "Qualitätssicherung": the metadata step, straight from a node — nothing to decide here. */
  showQuality(): void {
    this.navigation.go('quality');
  }

  /** "Inhaltsübersicht": the last big step, straight from a node. */
  showOverview(): void {
    this.navigation.go('overview');
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
