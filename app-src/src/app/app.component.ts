import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';

import { APP_CONFIG } from './config';
import { errorMessage } from './util/errors';
import { AdditionalWebComponentService } from './services/additional-web-component.service';
import { AuthService } from './services/auth.service';
import { BrowserExtensionService } from './services/browser-extension.service';
import { ConditionsService } from './services/conditions.service';
import { CurationService } from './services/curation.service';
import { HistoryEntry, HistoryService } from './services/history.service';
import { NavigationService } from './services/navigation.service';
import { OnlyOfficeDocumentService, PluginEnvelope } from './services/onlyoffice-document.service';

import { ActionBarComponent } from './components/action-bar.component';
import { HistoryComponent } from './components/history.component';
import { LoginComponent } from './components/login.component';
import { MenuComponent } from './components/menu.component';
import { SearchComponent } from './components/search.component';
import { SettingsComponent } from './components/settings.component';
import { StatusBarComponent } from './components/status-bar.component';
import { AnalyzeScreenComponent } from './components/screens/analyze-screen.component';
import { EnrichScreenComponent } from './components/screens/enrich-screen.component';
import { CollectionsScreenComponent } from './components/screens/collections-screen.component';
import { MetadataScreenComponent } from './components/screens/metadata-screen.component';
import { NewDocumentScreenComponent } from './components/screens/new-document-screen.component';
import { PreviewScreenComponent } from './components/screens/preview-screen.component';

/** Sender id of the OnlyOffice plugin messages relayed by content/panel-host.js. */
const PLUGIN_SOURCE = 'edu-sharing-onlyoffice-plugin';

/** Window in which the same node delivery is treated as a duplicate. */
const DUPLICATE_WINDOW_MS = 3000;

const DISCARD_PROMPT =
  'Es gibt eine noch nicht gespeicherte Erschließung. Trotzdem laden und die aktuelle verwerfen?';

@Component({
  selector: 'es-root',
  imports: [
    StatusBarComponent, ActionBarComponent, MenuComponent, LoginComponent, HistoryComponent,
    SettingsComponent, SearchComponent, AnalyzeScreenComponent, EnrichScreenComponent,
    NewDocumentScreenComponent, MetadataScreenComponent, PreviewScreenComponent,
    CollectionsScreenComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Events relayed from the OnlyOffice plugin (PREVIEW_NODE, DOCUMENT_INFO, DOCUMENT_CONTENT).
    // The sender is a cross-origin frame, so they are filtered by data.source, never by
    // event.origin.
    '(window:message)': 'onWindowMessage($event)'
  }
})
export class AppComponent implements OnInit {
  protected readonly auth = inject(AuthService);
  protected readonly navigation = inject(NavigationService);
  protected readonly conditions = inject(ConditionsService);

  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly additionalWebComponent = inject(AdditionalWebComponentService);
  private readonly curation = inject(CurationService);
  private readonly history = inject(HistoryService);
  private readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);

  /** A node received while logged out — opened once the user logs in. */
  private readonly pendingNodeId = signal<string | null>(null);

  /** Dedupe: the same delivery can arrive via both the storage replay and a live relay. */
  private lastNodeId: string | null = null;
  private lastNodeAt = 0;

  constructor() {
    effect(() => {
      const nodeId = this.pendingNodeId();
      if (nodeId && this.auth.loggedIn()) {
        this.pendingNodeId.set(null);
        void this.openNode(() => this.curation.openNode(nodeId));
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Only activates when the repository config enables `additionalWebComponent`.
    this.additionalWebComponent.initialize();
    await this.auth.init();
    await this.history.load();
    const tab = await this.browserExtension.getActiveTab().catch(() => null);
    this.conditions.activeUrl.set(tab?.url ?? null);

    // Land on the view that fits the current page: the options menu, or the login gate when
    // logged out.
    this.navigation.land();

    // Tell the host page we're ready so it can replay a buffered PREVIEW_NODE, then consume any
    // node that was persisted while the sidebar was closed or booting.
    this.browserExtension.signalReady();
    await this.consumePendingNode();
  }

  protected onWindowMessage(event: MessageEvent): void {
    const message = event.data as (PluginEnvelope & { source?: string }) | null;
    if (message?.source !== PLUGIN_SOURCE) return;
    // DOCUMENT_INFO / DOCUMENT_CONTENT belong to the document bridge, which resolves the
    // request that is waiting for them.
    if (this.onlyOfficeDocument.accept(message)) return;
    if (message.event !== 'PREVIEW_NODE') return;
    void this.receiveNode((message.data as { id?: string } | undefined)?.id);
  }

  protected close(): void {
    this.browserExtension.closePanel();
  }

  /** Open a saved node from the history (requested by the history screen). */
  protected async openFromHistory(entry: HistoryEntry): Promise<void> {
    if (!this.confirmDiscardUnsaved()) return;
    await this.openNode(() => this.curation.openFromHistory(entry));
  }

  protected hideBrokenLogo(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  /** Read and clear the node persisted by panel-host while the sidebar was closed or booting. */
  private async consumePendingNode(): Promise<void> {
    const pending = await this.browserExtension
      .storageGet<{ data?: { data?: { id?: string } } } | null>(
        APP_CONFIG.storageKeys.pendingPreview,
        null,
      )
      .catch(() => null);
    const nodeId = pending?.data?.data?.id;
    if (!nodeId) return;
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.pendingPreview, null);
    await this.receiveNode(nodeId);
  }

  /** Route a received node into the flow, deduping rapid duplicate deliveries. */
  private async receiveNode(nodeId: string | undefined): Promise<void> {
    if (!nodeId || this.isDuplicate(nodeId)) return;
    if (!this.confirmDiscardUnsaved()) return;
    if (!this.auth.loggedIn()) {
      // Not logged in yet → show the login gate; the effect opens the node after login.
      this.pendingNodeId.set(nodeId);
      this.navigation.land();
      return;
    }
    await this.openNode(() => this.curation.openNode(nodeId));
  }

  /**
   * Load a node into the flow and land on its preview; surface a failure to the user. Callers
   * confirm discarding unsaved work first (see {@link confirmDiscardUnsaved}).
   */
  private async openNode(load: () => Promise<void>): Promise<void> {
    try {
      await load();
      this.navigation.land({ nodeJustLoaded: true });
    } catch (cause: unknown) {
      alert('Der Node konnte nicht geladen werden: ' + errorMessage(cause));
    }
  }

  /** Ask before discarding a generated result that was never saved to a node. */
  private confirmDiscardUnsaved(): boolean {
    return !this.curation.hasUnsavedWork() || confirm(DISCARD_PROMPT);
  }

  private isDuplicate(nodeId: string): boolean {
    const now = Date.now();
    const duplicate = nodeId === this.lastNodeId && now - this.lastNodeAt < DUPLICATE_WINDOW_MS;
    this.lastNodeId = nodeId;
    this.lastNodeAt = now;
    return duplicate;
  }
}
