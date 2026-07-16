import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from './services/auth.service';
import { HistoryService } from './services/history.service';
import { ExtService } from './services/ext.service';
import { AnalyzeComponent } from './components/analyze.component';
import { HistoryComponent } from './components/history.component';
import { SettingsComponent } from './components/settings.component';
import { SearchComponent } from './components/search.component';

type Tab = 'analyze' | 'search' | 'history' | 'settings';

// URL pattern that reveals the "Suche nach Inhalten" tab (e.g. OnlyOffice editor).
const SEARCH_URL_PATTERN = /\/src\/tools\/onlyoffice/;

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

  readonly tab = signal<Tab>('analyze');
  readonly activeUrl = signal<string | null>(null);
  readonly showSearch = computed(() => SEARCH_URL_PATTERN.test(this.activeUrl() ?? ''));

  async ngOnInit(): Promise<void> {
    await this.auth.init();
    await this.history.load();
    try {
      const tab = await this.ext.getActiveTab();
      this.activeUrl.set(tab?.url ?? null);
    } catch { /* ignore */ }
  }

  close(): void {
    this.ext.closePanel();
  }

  onLogoError(ev: Event): void {
    (ev.target as HTMLImageElement).style.visibility = 'hidden';
  }
}
