import { Component, HostListener, OnInit, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from './services/auth.service';
import { HistoryEntry, HistoryService } from './services/history.service';
import { CurationService } from './services/curation.service';
import { ExtService } from './services/ext.service';
import { APP_CONFIG } from './config';
import { AnalyzeComponent } from './components/analyze.component';
import { HistoryComponent } from './components/history.component';
import { SettingsComponent } from './components/settings.component';
import { SearchComponent } from './components/search.component';

type Tab = 'analyze' | 'search' | 'history' | 'settings';

// URL pattern that reveals the "Inhalt suchen" tab (e.g. OnlyOffice editor).
const SEARCH_URL_PATTERN = /\/src\/tools\/onlyoffice/;

/** Host of a URL, lower-cased; '' when it cannot be parsed. */
function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).host.toLowerCase(); } catch { return ''; }
}

@Component({
  selector: 'es-root',
  standalone: true,
  imports: [CommonModule, AnalyzeComponent, HistoryComponent, SettingsComponent, SearchComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly ext = inject(ExtService);
  readonly history = inject(HistoryService);
  private readonly wiz = inject(CurationService);

  readonly tab = signal<Tab>('analyze');
  readonly activeUrl = signal<string | null>(null);
  readonly showSearch = computed(() => SEARCH_URL_PATTERN.test(this.activeUrl() ?? ''));

  // A node id received from the OnlyOffice plugin (PREVIEW_NODE) while logged out — loaded
  // into the wizard once the user logs in.
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

  // True when the active tab already lives on the configured repository host — there
  // "Erschließen" makes no sense (the page is Edu-Sharing itself). The Erschließung
  // tab stays visible but shows a context note instead of the wizard, so the panel is
  // never left without a primary tab.
  readonly onEduSharing = computed(() => {
    const repoHost = hostOf(this.auth.state().repositoryUrl);
    return !!repoHost && hostOf(this.activeUrl()) === repoHost;
  });

  async ngOnInit(): Promise<void> {
    await this.auth.init();
    await this.history.load();
    try {
      const tab = await this.ext.getActiveTab();
      this.activeUrl.set(tab?.url ?? null);
    } catch { /* ignore */ }
    // Land on the tab that actually applies to the current page: on an OnlyOffice
    // editor the user came to insert content, so open "Inhalt suchen" directly.
    if (this.showSearch()) this.tab.set('search');

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

  // Route a received preview node into the Erschließung wizard, exactly like a Verlauf
  // selection. Dedupes rapid duplicate deliveries (storage replay + live relay).
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
      this.tab.set('analyze');
      return;
    }
    await this.loadPreviewNode(id);
  }

  // Hydrate + open the node in the wizard (Vorschau, editable), then switch to the tab.
  private async loadPreviewNode(id: string): Promise<void> {
    try {
      await this.wiz.loadFromNode(id);
      this.tab.set('analyze');
    } catch (e: unknown) {
      alert('Der Node konnte nicht geladen werden: ' + String((e as Error)?.message || e));
    }
  }

  close(): void {
    this.ext.closePanel();
  }

  // Load a saved node (from Verlauf) into the Erschließung wizard at Vorschau. If there
  // is unsaved work (a generated result never saved to a node), confirm before discarding.
  async openInWizard(entry: HistoryEntry): Promise<void> {
    if (this.wiz.hasUnsavedWork() &&
        !confirm('Es gibt eine noch nicht gespeicherte Erschließung. Trotzdem laden und die aktuelle verwerfen?')) {
      return;
    }
    try {
      await this.wiz.loadFromHistory(entry);
      this.tab.set('analyze');
    } catch (e: unknown) {
      alert('Der Node konnte nicht geladen werden: ' + String((e as Error)?.message || e));
    }
  }

  onLogoError(ev: Event): void {
    (ev.target as HTMLImageElement).style.visibility = 'hidden';
  }
}
