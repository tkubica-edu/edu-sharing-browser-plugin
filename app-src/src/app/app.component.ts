import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from './services/auth.service';
import { HistoryEntry, HistoryService } from './services/history.service';
import { CurationService } from './services/curation.service';
import { ExtService } from './services/ext.service';
import { UiStateService } from './services/ui-state.service';
import { NavigationService } from './services/navigation.service';
import { ExtensionService } from './extension/extension.service';
import { ExtScreenComponent } from './extension/ext-screen.component';
import { APP_CONFIG } from './config';

import { StatusBarComponent } from './components/status-bar.component';
import { ActionBarComponent } from './components/action-bar.component';
import { MenuComponent } from './components/menu.component';
import { LoginComponent } from './components/login.component';
import { HistoryComponent } from './components/history.component';
import { SettingsComponent } from './components/settings.component';
import { SearchComponent } from './components/search.component';
import { AnalyzeScreenComponent } from './components/screens/analyze-screen.component';
import { NewDocumentScreenComponent } from './components/screens/new-document-screen.component';
import { MetadataScreenComponent } from './components/screens/metadata-screen.component';
import { PreviewScreenComponent } from './components/screens/preview-screen.component';
import { CollectionsScreenComponent } from './components/screens/collections-screen.component';

@Component({
  selector: 'es-root',
  standalone: true,
  imports: [
    CommonModule,
    StatusBarComponent, ActionBarComponent, MenuComponent,
    LoginComponent, HistoryComponent, SettingsComponent, SearchComponent,
    AnalyzeScreenComponent, NewDocumentScreenComponent, MetadataScreenComponent, PreviewScreenComponent, CollectionsScreenComponent,
    ExtScreenComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly ext = inject(ExtService);
  private readonly extensionService = inject(ExtensionService);
  readonly history = inject(HistoryService);
  private readonly wiz = inject(CurationService);
  readonly ui = inject(UiStateService);
  readonly nav = inject(NavigationService);

  // True when an extension provides (or overrides) the screen for the current view — the
  // shell renders that instead of the built-in switch case.
  readonly hasExtScreen = computed(() =>
    !!this.extensionService.getRendering('screen', this.nav.view(), this.ui.conditions()),
  );

  // A node id received from the OnlyOffice plugin (PREVIEW_NODE) while logged out — loaded
  // once the user logs in.
  private readonly pendingPreviewId = signal<string | null>(null);
  // Dedupe: the same delivery can arrive via both the storage replay and a live relay.
  private lastPreviewId: string | null = null;
  private lastPreviewAt = 0;

  constructor() {
    // Once logged in, load any node that was received while logged out.
    effect(() => {
      const id = this.pendingPreviewId();
      if (id && this.auth.state().loggedIn) {
        this.pendingPreviewId.set(null);
        void this.loadPreviewNode(id);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Boot the extension point: it only activates when the repository config provides
    // `additionalWebComponent`; otherwise this is a no-op and the default app is used.
    this.extensionService.initialize();
    await this.auth.init();
    await this.history.load();
    try {
      const tab = await this.ext.getActiveTab();
      this.ui.activeUrl.set(tab?.url ?? null);
    } catch { /* ignore */ }

    // Land on the view that fits the current page (search on an OnlyOffice editor, the
    // login gate when logged out, otherwise the options menu).
    this.nav.land();

    // Tell the host page we're ready so it can replay a buffered PREVIEW_NODE, and consume
    // any preview that was persisted while the sidebar was closed/booting.
    this.ext.signalReady();
    await this.consumePendingPreview();
  }

  // A PREVIEW_NODE relayed from the OnlyOffice plugin (via content/panel-host.js). The
  // sender is a cross-origin frame, so filter by data.source, never by event.origin.
  @HostListener('window:message', ['$event'])
  onWindowMessage(event: MessageEvent): void {
    const msg = event.data;
    if (!msg || msg.source !== 'edu-sharing-onlyoffice-plugin') return;
    if (msg.event === 'PREVIEW_NODE') {
      console.log('[edu-sharing][app] ⬅ received PREVIEW_NODE:', msg.data);
      void this.receivePreview(msg.data);
    }
  }

  // Read + clear the node persisted by panel-host while the sidebar was closed/booting.
  private async consumePendingPreview(): Promise<void> {
    try {
      const pending = await this.ext.storageGet<{ data?: { data?: { id?: string } } } | null>(
        APP_CONFIG.storageKeys.pendingPreview, null);
      const id = pending?.data?.data?.id;
      if (id) {
        await this.ext.storageSet(APP_CONFIG.storageKeys.pendingPreview, null);
        await this.receivePreview({ id });
      }
    } catch { /* ignore */ }
  }

  // Route a received preview node into the curation flow (opens at Vorschau). Dedupes rapid
  // duplicate deliveries (storage replay + live relay).
  private async receivePreview(data: { id?: string } | null | undefined): Promise<void> {
    const id = data?.id;
    if (!id) return;
    const now = Date.now();
    if (id === this.lastPreviewId && now - this.lastPreviewAt < 3000) return;
    this.lastPreviewId = id;
    this.lastPreviewAt = now;

    if (this.wiz.hasUnsavedWork() &&
        !confirm('Es gibt eine noch nicht gespeicherte Erschließung. Trotzdem laden und die aktuelle verwerfen?')) {
      return;
    }
    if (!this.auth.state().loggedIn) {
      // Not logged in yet → show the login gate; the effect loads it after login.
      this.pendingPreviewId.set(id);
      this.nav.land(); // → login
      return;
    }
    await this.loadPreviewNode(id);
  }

  // Hydrate + open the node in the curation flow (Vorschau), then land there.
  private async loadPreviewNode(id: string): Promise<void> {
    try {
      await this.wiz.loadFromNode(id);
      this.nav.land({ nodeJustLoaded: true });
    } catch (e: unknown) {
      alert('Der Node konnte nicht geladen werden: ' + String((e as Error)?.message || e));
    }
  }

  close(): void {
    this.ext.closePanel();
  }

  // Load a saved node (from Verlauf) into the curation flow at Vorschau. If there is
  // unsaved work (a generated result never saved to a node), confirm before discarding.
  async openInWizard(entry: HistoryEntry): Promise<void> {
    if (this.wiz.hasUnsavedWork() &&
        !confirm('Es gibt eine noch nicht gespeicherte Erschließung. Trotzdem laden und die aktuelle verwerfen?')) {
      return;
    }
    try {
      await this.wiz.loadFromHistory(entry);
      this.nav.land({ nodeJustLoaded: true });
    } catch (e: unknown) {
      alert('Der Node konnte nicht geladen werden: ' + String((e as Error)?.message || e));
    }
  }

  onLogoError(ev: Event): void {
    (ev.target as HTMLImageElement).style.visibility = 'hidden';
  }
}
