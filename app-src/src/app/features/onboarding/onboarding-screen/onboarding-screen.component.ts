import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { APP_CONFIG } from '../../../config';
import { IconDirective } from '../../../directives/icon.directive';
import { AuthService } from '../../../services/auth.service';
import { NavigationService } from '../../../services/navigation.service';
import { isRepositoryUrl } from '../../../util/repository-links';

// The one screen a fresh install shows before anything else: nothing is asked of a repository until
// this persists one (see the `onboarded` condition in model/navigation.ts and NavigationService.land)
// — the cleanest answer to why the extension asks for access to every page in the first place. The
// field starts empty; the suggestion chip only ever fills it on request, never on its own, so
// connecting to the shipped staging repository stays a choice rather than a default.
@Component({
  selector: 'es-onboarding-screen',
  imports: [FormsModule, IconDirective],
  templateUrl: './onboarding-screen.component.html',
  styleUrl: './onboarding-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OnboardingScreenComponent {
  private readonly auth = inject(AuthService);
  private readonly navigation = inject(NavigationService);

  /** The suggestion chip's value — the same address `METADATA_AGENT_API_URL` is derived from. */
  protected readonly suggestedRepositoryUrl = APP_CONFIG.defaultRepositoryUrl;

  protected readonly url = signal('');
  /** True once the field was touched, so the hint only shows after an attempt rather than on load. */
  protected readonly touched = signal(false);
  /** True while the chosen URL is being persisted, just before the reload it triggers. */
  protected readonly connecting = signal(false);

  protected readonly missingUrl = computed(() => this.touched() && !this.url().trim());
  protected readonly badUrlSuffix = computed(
    () => this.touched() && !!this.url().trim() && !isRepositoryUrl(this.url()),
  );
  protected readonly canConnect = computed(() => isRepositoryUrl(this.url()));

  protected setUrl(value: string): void {
    this.url.set(value);
  }

  protected touch(): void {
    this.touched.set(true);
  }

  /** Fill the field with the shipped suggestion — a click away, never automatic. */
  protected useSuggestion(): void {
    this.url.set(this.suggestedRepositoryUrl);
    this.touched.set(true);
  }

  /**
   * Persist the chosen repository and reload: the library that talks to it freezes its rootUrl at
   * bootstrap, so a repository chosen here only takes effect once the sidebar boots again — the same
   * reload the settings screen triggers for the same reason (AuthService.applyRepositoryChange).
   */
  protected async connect(): Promise<void> {
    this.touched.set(true);
    if (!this.canConnect() || this.connecting()) return;
    this.connecting.set(true);
    await this.auth.setRepositoryUrl(this.url());
    this.auth.applyRepositoryChange();
  }

  protected openPrivacy(): void {
    this.navigation.go('privacy');
  }
}
