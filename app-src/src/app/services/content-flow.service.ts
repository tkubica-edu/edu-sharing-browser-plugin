import { inject, Injectable, signal } from '@angular/core';

import { BrowserExtensionService } from './browser-extension.service';
import { ConditionsService } from './conditions.service';
import { CurationService } from './curation.service';
import { NavState, NavigationService } from './navigation.service';
import { NodeConnectorService } from './node-connector.service';
import { OnlyOfficeDocumentService } from './onlyoffice-document.service';
import { SessionResumeService } from './session-resume.service';

/**
 * Enters the big steps of the content flow for the active node. The branch is the connector: a node that opens in one
 * is edited there, everything else goes straight to the Qualitätsprüfung — and that check needs the repository's
 * connector list, hence {@link deciding}. Two steps belong on a page of their own, so the tab is taken along.
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
   * "Bearbeitungsmodus" when the node opens in a connector, else Qualitätsprüfung. The connector is asked for
   * twice over: whether there is one decides the branch, and the one there is provides the URL that opens the
   * content in it. The node's own page is the fallback for a connector that reports no URL.
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
   * "Inhaltsoptionen" for a content the user picked themselves, on that content's own page: picking is choosing
   * what to work on, so the tab follows. The step is carried across in the stored state rather than entered
   * first, so the panel stays where the user is until the page is there. Answers whether the tab was sent
   * anywhere — this panel does not outlive that, so what is still to be done for the content waits for the one
   * that comes back (see CurationService.pendingExtraction).
   *
   * Always the junction, whichever step the content was last worked on: picking a content is choosing what to
   * do with it next, and that choice is what the junction offers — being dropped straight back into the middle
   * of the flow answers it for the person. Where the content was left is still said, on the main menu's card
   * for it (see CurationService.leftAtStep).
   */
  async showContentOptions(): Promise<boolean> {
    const target = this.curation.activeNode()?.link;
    const state = this.navigation.stateFor('content-options');
    const ahead = target && target !== this.conditions.activeUrl() ? state : null;
    if (!target || !ahead) {
      this.navigation.go(state?.section ?? 'content-options', { tab: state?.tab ?? undefined });
      return false;
    }
    try {
      await this.openPage(target, ahead);
      return true;
    } catch (cause: unknown) {
      // The page stayed, so the step has to be entered here after all — nothing will restore it.
      this.navigation.go('content-options');
      throw cause;
    }
  }

  /**
   * The preview step of "Inhalt erschließen": the picture and the title of the content, checked before anything
   * else is done with it. Where a content that was just added goes — it exists as a node, but nothing has
   * described it yet, and this is the step that does. Its own footer carries the flow on from there.
   */
  showCurationPreview(): void {
    this.navigation.go('curation-preview');
  }

  /**
   * "Qualitätsprüfung": the quality and metadata step, straight from a node — nothing to decide.
   * On the Qualität tab: that is what the step is entered for, and the metadata are worked on off
   * the back of it.
   */
  showQuality(): void {
    this.navigation.go('quality', { tab: 'quality-check' });
  }

  /**
   * The Metadaten view of that same step, for describing a content rather than walking the check: the
   * step's other view, offered as an errand of its own. Where the criteria still gate it, the section
   * opens on the Qualität view instead — the one that unlocks it (see NavigationService.screen).
   */
  showMetadata(): void {
    this.navigation.go('quality', { tab: 'metadata' });
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

  /** "Interaktionen": the interactions tab of the Inhaltsübersicht, offered as a step of its own. */
  showInteractions(): void {
    this.navigation.go('overview', { tab: 'interactions' });
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
   * Take the current tab to `target` and have the panel come back there — on the step it is on, or on `state`
   * where that step belongs to the page being opened. The panel cannot survive the load, so it is restored
   * from storage instead. Same tab, since a window the panel cannot reach would leave the two apart.
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
   * Whether the content is already open for editing here — then the panel only switches into the
   * Bearbeitungsmodus, since replacing the page would throw away the editor the user works in. Two ways to tell,
   * because the connector redirects; an open document of unknown identity counts as open for the same reason.
   */
  private alreadyOpen(nodeId: string, target: string): boolean {
    if (this.conditions.onlyOfficePresent()) {
      const openNodeId = this.onlyOfficeDocument.currentDocument()?.nodeId;
      if (!openNodeId || openNodeId === nodeId) return true;
    }
    return this.conditions.activeUrl() === target;
  }
}
