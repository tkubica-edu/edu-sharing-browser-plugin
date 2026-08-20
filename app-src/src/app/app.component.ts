import {
  ChangeDetectionStrategy, Component, OnInit, effect, inject, signal, untracked
} from '@angular/core';

import { APP_CONFIG } from './config';
import { PLUGIN_SOURCE, PluginEnvelope } from './model/onlyoffice-events';
import { errorMessage } from './util/errors';
import { BrowserExtensionCustomWebComponentService } from './services/browser-extension-custom-web-component.service';
import { AuthService } from './services/auth.service';
import { BrowserExtensionService } from './services/browser-extension.service';
import { ContentFlowService } from './services/content-flow.service';
import { BusyService } from './services/busy.service';
import { AssistantRequestService } from './services/assistant-request.service';
import { ChatSkillService } from './services/chat-skill.service';
import { ChatStyleService } from './services/chat-style.service';
import { CollectionRecommendationService } from './services/collection-recommendation.service';
import { ConditionsService } from './services/conditions.service';
import { CurationService } from './services/curation.service';
import { DebugService } from './services/debug.service';
import { DevModeService } from './services/dev-mode.service';
import { HistoryEntry, HistoryService } from './services/history.service';
import { NavigationService } from './services/navigation.service';
import { OnlyOfficeDocumentService } from './services/onlyoffice-document.service';
import { OptionIconService } from './services/option-icon.service';
import { PageRecognitionService } from './services/page-recognition.service';
import { QualityJudgeService } from './services/quality-judge.service';
import { SessionResumeService } from './services/session-resume.service';

import { IconDirective } from './directives/icon.directive';
import { ActionBarComponent } from './template/action-bar/action-bar.component';
// Commented out with the tag in the template — see the note there.
// import { AiAssistantBarComponent } from './template/ai-assistant-bar/ai-assistant-bar.component';
import { MenuComponent } from './template/menu/menu.component';
import { TabBarComponent } from './template/tab-bar/tab-bar.component';
import { UserBarComponent } from './template/user-bar/user-bar.component';
import { AiAssistantScreenComponent } from './features/assistant/ai-assistant-screen/ai-assistant-screen.component';
import { LoginGateComponent } from './features/auth/login-gate/login-gate.component';
import { LoginComponent } from './features/auth/login/login.component';
import { AddContentScreenComponent } from './features/content/add-content-screen/add-content-screen.component';
import { AddMaterialScreenComponent } from './features/content/add-material-screen/add-material-screen.component';
import { ContentOptionsScreenComponent } from './features/content/content-options-screen/content-options-screen.component';
import { FindContentScreenComponent } from './features/content/find-content-screen/find-content-screen.component';
import { HistoryScreenComponent } from './features/content/history-screen/history-screen.component';
import { NewDocumentScreenComponent } from './features/content/new-document-screen/new-document-screen.component';
import { OwnContentScreenComponent } from './features/content/own-content-screen/own-content-screen.component';
import { SearchScreenComponent } from './features/content/search-screen/search-screen.component';
import { CurationPreviewScreenComponent } from './features/curation/curation-preview-screen/curation-preview-screen.component';
import { CurationScreenComponent } from './features/curation/curation-screen/curation-screen.component';
import { EditorialForwardScreenComponent } from './features/filing/editorial-forward-screen/editorial-forward-screen.component';
import { PersonalStorageScreenComponent } from './features/filing/personal-storage-screen/personal-storage-screen.component';
import { SelectCollectionScreenComponent } from './features/filing/select-collection-screen/select-collection-screen.component';
import { MetadataScreenComponent } from './features/metadata/metadata-screen/metadata-screen.component';
import { InteractionsScreenComponent } from './features/overview/interactions-screen/interactions-screen.component';
import { PreviewScreenComponent } from './features/overview/preview-screen/preview-screen.component';
import { ShareScreenComponent } from './features/overview/share-screen/share-screen.component';
import { UsagesScreenComponent } from './features/overview/usages-screen/usages-screen.component';
import { AiQualityScreenComponent } from './features/quality/ai-quality-screen/ai-quality-screen.component';
import { FlowChoiceScreenComponent } from './features/quality/flow-choice-screen/flow-choice-screen.component';
import { QualityCheckScreenComponent } from './features/quality/quality-check-screen/quality-check-screen.component';
import { SettingsScreenComponent } from './features/settings/settings-screen/settings-screen.component';

/** Window in which the same node delivery is treated as a duplicate. */
const DUPLICATE_WINDOW_MS = 3000;

const DISCARD_PROMPT =
  'Es gibt eine noch nicht gespeicherte Erschließung. Trotzdem laden und die aktuelle verwerfen?';

@Component({
  selector: 'es-root',
  imports: [
    IconDirective,
    // AiAssistantBarComponent belongs here — commented out with its tag, see the template.
    ActionBarComponent, TabBarComponent, UserBarComponent, MenuComponent,
    LoginComponent, LoginGateComponent, AiAssistantScreenComponent, HistoryScreenComponent,
    SettingsScreenComponent, SearchScreenComponent, AddContentScreenComponent,
    ContentOptionsScreenComponent, CurationScreenComponent, CurationPreviewScreenComponent,
    FindContentScreenComponent,
    NewDocumentScreenComponent, AddMaterialScreenComponent, OwnContentScreenComponent,
    QualityCheckScreenComponent, MetadataScreenComponent, PreviewScreenComponent,
    EditorialForwardScreenComponent, PersonalStorageScreenComponent, SelectCollectionScreenComponent,
    FlowChoiceScreenComponent, AiQualityScreenComponent,
    UsagesScreenComponent, ShareScreenComponent, InteractionsScreenComponent
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
  private readonly contentFlow = inject(ContentFlowService);
  private readonly browserExtensionCustomWebComponent = inject(BrowserExtensionCustomWebComponentService);
  private readonly curation = inject(CurationService);
  private readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);
  private readonly pageRecognition = inject(PageRecognitionService);
  private readonly debug = inject(DebugService);
  private readonly devMode = inject(DevModeService);
  private readonly recommendations = inject(CollectionRecommendationService);
  private readonly qualityJudge = inject(QualityJudgeService);
  private readonly chatStyle = inject(ChatStyleService);
  private readonly chatSkill = inject(ChatSkillService);
  private readonly assistantRequest = inject(AssistantRequestService);
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
    // over — the background worker is what notices it (see BrowserExtensionService.announcedPage).
    effect(() => {
      const page = this.browserExtension.announcedPage();
      if (page && this.booted()) untracked(() => this.pageChanged(page.url, page.title));
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
    // Only activates when the repository config enables `browserExtensionCustomWebComponent`.
    this.browserExtensionCustomWebComponent.initialize();
    // First of all: the debug flag decides `onlyOfficePresent`, which the section visibilities
    // and the document request below are gated on.
    await this.debug.load();
    // Before anything can ask one of the faked services — a resumed session may start an
    // Erschließung of its own further down this boot.
    await this.devMode.load();
    // How a collection is proposed, before a step can ask for one — a proposal picks a collection, and
    // it should be the one the settings ask for rather than the one the defaults would.
    await this.recommendations.load();
    // Which judges are asked, before a content can be judged — a resumed session may start its
    // Erschließung on this boot, and the judgement follows it.
    await this.qualityJudge.load();
    // Before the assistant screen can mount its chat element, which reads both switches as it creates it.
    await this.chatStyle.load();
    await this.chatSkill.load();
    // Before a page is erschlossen — the run reports its text length against this bound — and before a check
    // builds a task, which is cut to fit it.
    await this.assistantRequest.load();
    await this.auth.init();
    await this.history.load();
    const tab = await this.browserExtension.getActiveTab().catch(() => null);
    this.conditions.activeUrl.set(tab?.url ?? null);
    this.conditions.activeTitle.set(tab?.title ?? null);

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
    // PREVIEW_NODE is deliberately not routed into the flow: a double-click on an object in the editor fires it, and
    // adopting that node would throw the user out of whatever they are doing. {@link receiveNode} is what would do it.
  }

  protected close(): void {
    // Closing is deliberate, unlike a page change: the next opening starts at the main menu, so the
    // carried-over state is dropped rather than restored into it.
    void this.sessionResume.clear();
    this.browserExtension.closePanel();
  }

  /**
   * Open a saved node from the history (requested by the history screen). The content is taken up at the
   * *Inhaltsoptionen* junction — picking it from the list is choosing what to work on, and what to do with it
   * is the next choice rather than one the panel makes — and the tab follows the pick to that content's own
   * page, see ContentFlowService.showContentOptions.
   */
  protected async openFromHistory(entry: HistoryEntry): Promise<void> {
    if (!this.confirmDiscardUnsaved()) return;
    await this.openNode(
      () => this.curation.openFromHistory(entry),
      async () => {
        // Only for an entry that carries no run of its own, and only where this panel stays: a tab that
        // follows the pick tears it down, and the panel that comes back on the new page picks the
        // Erschließung up from the stored state (CurationService.runPendingExtraction).
        if (!(await this.contentFlow.showContentOptions())) {
          void this.curation.runPendingExtraction();
        }
      },
    );
  }

  protected hideBrokenLogo(event: Event): void {
    (event.target as HTMLImageElement).style.visibility = 'hidden';
  }

  /**
   * Adopt a page this app was not rebooted for: the conditions, the content that described the previous page, and then
   * the recognition of the new one. Order matters — the conditions first, because the recognition reads them, and the
   * release before that, since it refuses to adopt while a content is still held.
   */
  private pageChanged(url: string, title: string | null = null): void {
    // The title is taken even where the address stayed the same: a page routing in place is announced
    // before it has renamed itself, so its title arrives as an announcement of its own.
    if (title) this.conditions.activeTitle.set(title);
    if (url === this.conditions.activeUrl()) return;
    this.conditions.activeUrl.set(url);
    // Cleared where the announcement brought none, so the previous page's title cannot describe this one.
    if (!title) this.conditions.activeTitle.set(null);
    this.curation.releaseDetectedContent();
    void this.pageRecognition.recognize();
  }

  /**
   * On an OnlyOffice page, ask once for the open document's identity so it becomes the node the app works on. This
   * is the recognition for such a page — the plugin states the document instead of the URL being looked up — so it
   * settles `recognizingContent` too, including when the plugin is off and the request times out.
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
    // Read and cleared, but not adopted: this is the buffered PREVIEW_NODE, which is not routed into the flow either
    // (see onWindowMessage). Clearing it here keeps a stale entry from surfacing later.
    void nodeId;
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
   * Load a node into the flow and surface a failure to the user; callers confirm discarding unsaved work first.
   * Without an `enter` the app re-lands on the main menu, where the node shows up as the *Inhalt erkannt* entry — a
   * node that merely arrived never navigates for the user.
   */
  private async openNode(load: () => Promise<void>, enter?: () => Promise<void>): Promise<void> {
    try {
      await load();
      if (enter) await enter();
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
