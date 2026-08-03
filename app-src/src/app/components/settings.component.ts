import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { APP_CONFIG } from '../config';
import { AuthService } from '../services/auth.service';
import { DebugService } from '../services/debug.service';

// Repository configuration plus the debug switch. Changing the URL requires a reload, because the
// API library freezes its rootUrl at bootstrap (see AuthService).
@Component({
  selector: 'es-settings',
  imports: [FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsComponent {
  protected readonly auth = inject(AuthService);
  protected readonly debug = inject(DebugService);

  protected readonly repositoryUrl = signal(this.auth.repositoryUrl());
  /** True once the field was edited, so the "required" hint only shows after a change. */
  protected readonly touched = signal(false);

  protected readonly missingUrl = computed(() => this.touched() && !this.repositoryUrl().trim());

  protected apply(url: string): void {
    this.repositoryUrl.set(url);
    this.touched.set(true);
    this.auth.setRepositoryUrl(url);
  }

  protected resetToDefault(): void {
    this.apply(APP_CONFIG.defaultRepositoryUrl);
  }

  protected reload(): void {
    this.auth.applyRepositoryChange();
  }

  // ---- Debug mode ---------------------------------------------------------
  // Persisting is fire-and-forget: the signal already carries the new state, and a failed write
  // only means the flag is not remembered across reloads.
  protected setDebug(enabled: boolean): void {
    void this.debug.setEnabled(enabled);
  }

  protected setDebugNodeId(nodeId: string): void {
    void this.debug.setDocumentNodeId(nodeId);
  }

  protected simulatePreviewNode(): void {
    this.debug.emitPreviewNode();
  }
}
