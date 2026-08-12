import { inject, Injectable, signal } from '@angular/core';

import { BrowserExtensionService } from './browser-extension.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';
import { NavState, NavigationService } from './navigation.service';
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
 *
 * It is also where the tab is taken along: two of the steps belong on a page of their own — the
 * editing on the editor's, the Inhaltsoptionen on the content's — and the panel is restored on it
 * (see {@link openPage}).
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
   * "Inhaltsoptionen" for a content the user picked themselves (Meine Inhalte, Verlauf), on that
   * content's own page in the repository (`…/components/render/<id>`).
   *
   * Picking a content is choosing what to work on, so the tab follows: the page then shows the very
   * node the panel's steps act on, and everything the repository knows about it is one click away
   * instead of behind the panel. The panel comes back on this step, working on the same node — it
   * cannot survive the load, so it is restored (see {@link openPage}).
   *
   * The step is *not* entered before that load: it belongs to the page being opened, so it is carried
   * across in the stored state (NavigationService.stateFor) and the panel stays on the screen the user
   * picked from until the page is there. Entering it here would show the Inhaltsoptionen for the
   * moment before the load replaces them, which reads as the panel arriving and then reloading.
   *
   * Where no load follows — the content's page is already open, or the tab could not be taken there —
   * the step is entered right away instead.
   */
  async showContentOptions(): Promise<void> {
    const target = this.curation.activeNode()?.link;
    const ahead = target && target !== this.conditions.activeUrl()
      ? this.navigation.stateFor('content-options')
      : null;
    if (!target || !ahead) {
      this.navigation.go('content-options');
      return;
    }
    try {
      await this.openPage(target, ahead);
    } catch (cause: unknown) {
      // The page stayed, so the step has to be entered here after all — nothing will restore it.
      this.navigation.go('content-options');
      throw cause;
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

  /** "Nutzung": the usage tab of the Inhaltsübersicht, offered as a step of its own. */
  showUsages(): void {
    this.navigation.go('overview', { tab: 'usages' });
  }

  /** "Freigabe": the sharing tab of the Inhaltsübersicht, offered as a step of its own. */
  showShare(): void {
    this.navigation.go('overview', { tab: 'share' });
  }

  /**
   * Take the current tab to where the content is edited: the connector's URL, or the node's page in
   * the repository (`…/components/render/<id>`) when there is none — *unless the editing is already
   * on screen*, see {@link alreadyOpen}.
   */
  private async openNodePage(connectorUrl?: string): Promise<void> {
    const node = this.curation.activeNode();
    if (!node) return;
    const target = connectorUrl || node.link;
    if (this.alreadyOpen(node.nodeId, target)) return;
    await this.openPage(target);
  }

  /**
   * Take the current tab to `target` and have the panel come back there — on the step it is on, or on
   * `state` where the step belongs to the page being opened. A tab that already stands on that page is
   * left alone: there is nothing to navigate to.
   *
   * The panel cannot survive the load — it is an iframe in the page — so it is *restored* instead:
   * the state is written to storage first, the background worker reopens the panel on the new page,
   * and the app picks the state back up on boot. Same tab, not a new one: a content opened in a
   * window the panel cannot reach would leave the two apart.
   */
  private async openPage(target: string, state?: NavState): Promise<void> {
    if (this.conditions.activeUrl() === target) return;
    // Save BEFORE navigating: the load tears this app down without further notice. The page we are
    // about to open goes into the state as the page it belongs to, so the panel comes back working
    // on it — this navigation is the flow continuing, not the page changing under it (see
    // SessionResumeService.nodeStillApplies).
    await this.sessionResume.save(target, state);
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
