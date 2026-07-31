import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { APP_CONFIG } from '../config';
import { AuthService } from '../services/auth.service';

// Repository configuration. Changing the URL requires a reload, because the API library freezes
// its rootUrl at bootstrap (see AuthService).
@Component({
  selector: 'es-settings',
  imports: [FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsComponent {
  protected readonly auth = inject(AuthService);

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
}
