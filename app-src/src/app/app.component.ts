import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from './services/auth.service';
import { HistoryEntry, HistoryService } from './services/history.service';
import { CurationService } from './services/curation.service';
import { ExtService } from './services/ext.service';
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
