import {
  ChangeDetectionStrategy, Component, OnInit, effect, inject, signal, untracked
} from '@angular/core';

import { APP_CONFIG } from './config';
import { SectionId } from './model/navigation';
import { PLUGIN_SOURCE, PluginEnvelope } from './model/onlyoffice-events';
import { errorMessage } from './util/errors';
import { AdditionalWebComponentService } from './services/additional-web-component.service';
import { AuthService } from './services/auth.service';
import { BrowserExtensionService } from './services/browser-extension.service';
import { BusyService } from './services/busy.service';
import { ConditionsService } from './services/conditions.service';
import { CurationService } from './services/curation.service';
import { DebugService } from './services/debug.service';
import { HistoryEntry, HistoryService } from './services/history.service';
import { NavigationService } from './services/navigation.service';
import { OnlyOfficeDocumentService } from './services/onlyoffice-document.service';
import { OptionIconService } from './services/option-icon.service';
import { PageRecognitionService } from './services/page-recognition.service';
import { SessionResumeService } from './services/session-resume.service';

import { ActionBarComponent } from './components/action-bar.component';
import { HistoryComponent } from './components/history.component';
import { LoginComponent } from './components/login.component';
import { MenuComponent } from './components/menu.component';
import { SearchComponent } from './components/search.component';
import { SettingsComponent } from './components/settings.component';
import { StatusBarComponent } from './components/status-bar.component';
import { TabBarComponent } from './components/tab-bar.component';
import { UserBarComponent } from './components/user-bar.component';
import { AddContentScreenComponent } from './components/screens/add-content-screen.component';
import { AddMaterialScreenComponent } from './components/screens/add-material-screen.component';
import { ContentOptionsScreenComponent } from './components/screens/content-options-screen.component';
import { CurationPreviewScreenComponent } from './components/screens/curation-preview-screen.component';
import { CurationScreenComponent } from './components/screens/curation-screen.component';
import { FindContentScreenComponent } from './components/screens/find-content-screen.component';
import { EditorialForwardScreenComponent } from './components/screens/editorial-forward-screen.component';
import { PersonalStorageScreenComponent } from './components/screens/personal-storage-screen.component';
import { MetadataScreenComponent } from './components/screens/metadata-screen.component';
import { NewDocumentScreenComponent } from './components/screens/new-document-screen.component';
import { OwnContentScreenComponent } from './components/screens/own-content-screen.component';
import { PreviewScreenComponent } from './components/screens/preview-screen.component';
import { QualityCheckScreenComponent } from './components/screens/quality-check-screen.component';
import { ShareScreenComponent } from './components/screens/share-screen.component';
import { UsagesScreenComponent } from './components/screens/usages-screen.component';

/** Window in which the same node delivery is treated as a duplicate. */
const DUPLICATE_WINDOW_MS = 3000;

const DISCARD_PROMPT =
  'Es gibt eine noch nicht gespeicherte Erschließung. Trotzdem laden und die aktuelle verwerfen?';

@Component({
  selector: 'es-root',
  imports: [
    StatusBarComponent, ActionBarComponent, TabBarComponent, UserBarComponent, MenuComponent,
    LoginComponent, HistoryComponent, SettingsComponent, SearchComponent, AddContentScreenComponent,
    ContentOptionsScreenComponent, CurationScreenComponent, CurationPreviewScreenComponent,
    FindContentScreenComponent,
    NewDocumentScreenComponent, AddMaterialScreenComponent, OwnContentScreenComponent,
    QualityCheckScreenComponent, MetadataScreenComponent, PreviewScreenComponent,
    EditorialForwardScreenComponent, PersonalStorageScreenComponent,
    UsagesScreenComponent, ShareScreenComponent
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
  // Disables the shell's controls while a write is in flight — see BusyService.
  protected readonly busy = inject(BusyService);
  protected readonly navigation = inject(NavigationService);
  protected readonly conditions = inject(ConditionsService);
  // Loaded on boot; the Verlauf's entries feed its menu entry and its screen.
  protected readonly history = inject(HistoryService);
  protected readonly icons = inject(OptionIconService);

  private readonly browserExtension = inject(BrowserExtensionService);
  private readonly additionalWebComponent = inject(AdditionalWebComponentService);
  private readonly curation = inject(CurationService);
  private readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);
  private readonly pageRecognition = inject(PageRecognitionService);
  private readonly debug = inject(DebugService);
  private readonly sessionResume = inject(SessionResumeService);

  /** A node received while logged out — opened once the user logs in. */
  private readonly pendingNodeId = signal<string | null>(null);

  /** Dedupe: the same delivery can arrive via both the storage replay and a live relay. */
  private lastNodeId: string | null = null;
  private lastNodeAt = 0;

  /** Guard: the host's open document is adopted as the active node at most once. */
  private documentAdopted = false;

  /** Set once the boot finished, so the page recognition cannot outrun the session restore. */
  private readonly booted = signal(false);

  constructor() {
    effect(() => {
      const nodeId = this.pendingNodeId();
      if (nodeId && this.auth.authorized()) {
        this.pendingNodeId.set(null);
        void this.openNode(() => this.curation.openNode(nodeId, 'detected'));
      }
    });

    // Ask the repository whether it already holds the open page as a content, so a find surfaces as
    // the *Inhalt erkannt* menu entry (see PageRecognitionService, which decides for itself when
    // there is nothing to ask). An effect rather than a step of the boot, because the lookup needs a
    // session: on a page opened logged out it runs again once the login exists. `untracked`, so it
    // is the login that re-triggers it and not every signal the lookup happens to read.
    effect(() => {
      if (this.booted() && this.auth.authorized()) {
        untracked(() => void this.pageRecognition.recognize());
      }
    });

    // The tab's URL can change without this app being torn down: an edu-sharing page routes in place
    // (History API), so the panel keeps running while the page becomes another one. Take that page
    // over — the background worker is what notices it (see BrowserExtensionService.announcedUrl).
    effect(() => {
      const url = this.browserExtension.announcedUrl();
      if (url && this.booted()) untracked(() => this.pageChanged(url));
    });

    // Make the document the host has open the active node, as soon as its node is loaded. An
    // effect rather than a `then()` on the request below, because the panel is usually opened
    // logged out: the id arrives immediately, the node only once a session exists (the service
    // retries the load after login). A plain field, not a signal, so this never re-triggers itself.
    effect(() => {
      const node = this.onlyOfficeDocument.documentNode();
      if (!node || this.documentAdopted) return;
      this.documentAdopted = true;
      this.curation.adoptDetectedNode(node);
    });
  }

  async ngOnInit(): Promise<void> {
    // Only activates when the repository config enables `additionalWebComponent`.
    this.additionalWebComponent.initialize();
    // First of all: the debug flag decides `onlyOfficePresent`, which the section visibilities
    // and the document request below are gated on.
    await this.debug.load();
    await this.auth.init();
    await this.history.load();
    const tab = await this.browserExtension.getActiveTab().catch(() => null);
    this.conditions.activeUrl.set(tab?.url ?? null);

    // The panel is reopened after every page change (see background.js), so this boot may be the
    // continuation of what the user was doing before the page changed. Pick that state back up
    // instead of starting over; only then is landing skipped.
    if (!(await this.sessionResume.restore())) {
      // Land on the view that fits the current context: the main menu, or the login gate when
      // logged out.
      this.navigation.land();
    }
    // From here on the state is persisted as it changes — after the restore, so it is not overwritten
    // by the state this boot started from.
    this.sessionResume.track();

    // Tell the host page we're ready so it can replay a buffered PREVIEW_NODE, then consume any
    // node that was persisted while the sidebar was closed or booting.
    this.browserExtension.signalReady();
    await this.consumePendingNode();

    // Fire-and-forget: the plugin is an optional background plugin, so awaiting it would stall the
    // boot until the timeout.
    if (this.conditions.onlyOfficePresent()) void this.askHostForItsDocument();

    // Last: the boot is done, which releases the page recognition (see the effect above).
    this.booted.set(true);
  }

  protected onWindowMessage(event: MessageEvent): void {
    const message = event.data as (PluginEnvelope & { source?: string }) | null;
    if (message?.source !== PLUGIN_SOURCE) return;
    // DOCUMENT_INFO / DOCUMENT_CONTENT belong to the document bridge, which resolves the
    // request that is waiting for them.
    if (this.onlyOfficeDocument.accept(message)) return;
    if (message.event !== 'PREVIEW_NODE') return;
    // SUSPENDED: a double-click on an object in the editor fires this, and loading its node as the
    // active node throws the user out of whatever they were doing. Uncomment to restore it.
    // void this.receiveNode((message.data as { id?: string } | undefined)?.id);
  }

  protected close(): void {
    // Closing is deliberate, unlike a page change: the next opening starts at the main menu, so the
    // carried-over state is dropped rather than restored into it.
    void this.sessionResume.clear();
    this.browserExtension.closePanel();
  }

  /**
   * Open a saved node from the history (requested by the history screen). A picked node is handled
   * exactly like a detected one: the *Inhaltsoptionen* screen offers the two ways on.
   */
  protected async openFromHistory(entry: HistoryEntry): Promise<void> {
    if (!this.confirmDiscardUnsaved()) return;
    await this.openNode(() => this.curation.openFromHistory(entry), 'content-options');
  }

  protected hideBrokenLogo(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  /**
   * Adopt a page this app was not rebooted for.
   *
   * Everything derived from the URL has to follow it: the conditions (which page this is, whether it
   * is an insert host or the repository), the content that described the *previous* page — a detected
   * one, see CurationService.releaseDetectedContent — and then the new page is recognised like any
   * other, so its own node surfaces as *Inhalt erkannt*.
   *
   * Order matters: the conditions first, because the recognition reads them; the release before it,
   * because it refuses to adopt while a content is still held.
   */
  private pageChanged(url: string): void {
    if (url === this.conditions.activeUrl()) return;
    this.conditions.activeUrl.set(url);
    this.curation.releaseDetectedContent();
    void this.pageRecognition.recognize();
  }

  /**
   * On an OnlyOffice page, ask once for the open document's identity so it becomes the node the app
   * works on (the effect in the constructor adopts it).
   *
   * This is the recognition for such a page — the plugin states the document instead of the URL being
   * looked up (see PageRecognitionService) — so it settles `recognizingContent` as well, including
   * when the plugin is switched off and the request runs into its timeout.
   */
  private async askHostForItsDocument(): Promise<void> {
    try {
      if (!this.onlyOfficeDocument.currentDocument()) await this.onlyOfficeDocument.requestInfo();
    } catch {
      // No answer, no content — the failure itself is the finding and needs no report of its own.
    } finally {
      this.conditions.recognizingContent.set(false);
    }
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
    // SUSPENDED together with the live PREVIEW_NODE relay in `onWindowMessage` — this is the same
    // event, only buffered while the sidebar was closed or booting. The entry is still read and
    // cleared above, so a stale one cannot surface later. Uncomment to restore it.
    void nodeId;
    // await this.receiveNode(nodeId);
  }

  /**
   * Route a received node into the flow, deduping rapid duplicate deliveries. It counts as
   * *detected*, not picked: the host page pushed it, so it describes the open page and survives a
   * return to the main menu (see CurationService.releaseChosenContent).
   */
  private async receiveNode(nodeId: string | undefined): Promise<void> {
    if (!nodeId || this.isDuplicate(nodeId)) return;
    // Already the app's content — reloading it would only throw away where the user is. Matters on
    // the node's own page, which announces the node the panel arrived there to work on.
    if (this.curation.activeNode()?.nodeId === nodeId) return;
    if (!this.confirmDiscardUnsaved()) return;
    if (!this.auth.authorized()) {
      // Not logged in yet → show the login gate; the effect opens the node after login.
      this.pendingNodeId.set(nodeId);
      this.navigation.land();
      return;
    }
    await this.openNode(() => this.curation.openNode(nodeId, 'detected'));
  }

  /**
   * Load a node into the flow; surface a failure to the user. Callers confirm discarding unsaved
   * work first (see {@link confirmDiscardUnsaved}).
   *
   * Without a `target` the app re-lands on the main menu, where the loaded node shows up as the
   * *Inhalt erkannt* menu entry — a node that merely arrived never navigates for the user.
   */
  private async openNode(load: () => Promise<void>, target?: SectionId): Promise<void> {
    try {
      await load();
      if (target) this.navigation.go(target);
      else this.navigation.land();
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
