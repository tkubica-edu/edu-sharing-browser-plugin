import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { APP_CONFIG } from '../../../config';
import { AuthService } from '../../../services/auth.service';
import { ContextRefreshService } from '../../../services/context-refresh.service';
import { DebugService } from '../../../services/debug.service';
import { DevModeService } from '../../../services/dev-mode.service';

// Repository configuration plus the two development switches. Changing the URL requires a reload,
// because the API library freezes its rootUrl at bootstrap (see AuthService).
@Component({
  selector: 'es-settings-screen',
  imports: [FormsModule],
  templateUrl: './settings-screen.component.html',
  styleUrl: './settings-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsScreenComponent implements OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly debug = inject(DebugService);
  protected readonly devMode = inject(DevModeService);

  private readonly contextRefresh = inject(ContextRefreshService);

  protected readonly repositoryUrl = signal(this.auth.repositoryUrl());
  /** True once the field was edited, so the "required" hint only shows after a change. */
  protected readonly touched = signal(false);

  protected readonly missingUrl = computed(() => this.touched() && !this.repositoryUrl().trim());

  /** Set by every setting, so leaving without having changed anything costs no requests. */
  private changed = false;

  /**
   * Leaving the settings re-runs the checks whose answers the changed settings may have invalidated — the menu the
   * user lands on is built on them, and they are otherwise answered once on boot.
   */
  ngOnDestroy(): void {
    if (this.changed) void this.contextRefresh.refresh();
  }

  protected apply(url: string): void {
    this.repositoryUrl.set(url);
    this.touched.set(true);
    this.changed = true;
    this.auth.setRepositoryUrl(url);
  }

  protected resetToDefault(): void {
    this.apply(APP_CONFIG.defaultRepositoryUrl);
  }

  /** Take the changed repository over right away, instead of leaving it to the screen being left. */
  protected reload(): void {
    void this.contextRefresh.refresh();
  }

  // ---- Debug mode ---------------------------------------------------------
  // Persisting is fire-and-forget: the signal already carries the new state, and a failed write
  // only means the flag is not remembered across reloads.
  protected setDebug(enabled: boolean): void {
    this.changed = true;
    void this.debug.setEnabled(enabled);
  }

  protected setDebugNodeId(nodeId: string): void {
    this.changed = true;
    void this.debug.setDocumentNodeId(nodeId);
  }

  protected simulatePreviewNode(): void {
    this.debug.emitPreviewNode();
  }

  // ---- Dev mode -----------------------------------------------------------
  protected setDevMode(enabled: boolean): void {
    this.changed = true;
    void this.devMode.setEnabled(enabled);
  }
}
