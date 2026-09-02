import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { IconDirective } from '../../../directives/icon.directive';
import { AuthService } from '../../../services/auth.service';
import { OAuthProvider } from '../../../services/oauth.service';
import { RepositoryPageService } from '../../../services/repository-page.service';

/**
 * What the login field takes. edu-sharing accepts either, and which of the two a person has been
 * given differs per instance — so the placeholder names both rather than asking for the one the
 * user may not have.
 */
const USER_PLACEHOLDER = 'E-Mail-Adresse oder Benutzername';

// The shared login: the way into the repository while logged out, a compact status row once logged in — and the
// session is shared, so signing in here unblocks every screen. One card for both places it is asked for, the Login
// section and a section a guest cannot be served by, whose two lines of text are inputs. Which way in it offers
// follows from the repository: its identity provider where it publishes one, username and password where it does not
// (see AuthService.passwordLoginOffered). Registering and resetting a password are the repository's own forms,
// opened in the docked tab (RepositoryPageService).
@Component({
  selector: 'es-login',
  imports: [FormsModule, IconDirective],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);
  private readonly repositoryPages = inject(RepositoryPageService);

  /** The form's headline. Defaults to what the Login section asks for. */
  readonly heading = input('Anmelden');

  /** The line under the headline; unset leaves it to {@link leadText}. */
  readonly lead = input<string | null>(null);

  /**
   * What the line says: the caller's text, else what a login *offered* is about — the Login section is
   * reached from the session bar, where nothing demands one.
   */
  protected readonly leadText = computed(
    () =>
      this.lead() ??
      (this.auth.loginRequired()
        ? 'Melde dich an, um mit dem Repository zu arbeiten.'
        : 'Ohne Anmeldung sind nur öffentliche Inhalte verfügbar.'),
  );

  protected readonly userPlaceholder = USER_PLACEHOLDER;

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly loggingIn = signal(false);

  /** Whether the password is shown as text — see the eye in the template. */
  protected readonly passwordVisible = signal(false);

  protected readonly canSubmit = computed(
    () => !!this.username() && !!this.password() && !this.auth.needsReload() && !this.loggingIn(),
  );

  /**
   * The identity providers offered as buttons: the ones the repository advertises, else a single
   * unnamed one that leads to the server's own chooser — which is the same question, asked one step
   * later. Empty where the repository federates against nothing, and the card is then the credential
   * form alone.
   */
  protected readonly oauthButtons = computed<readonly (OAuthProvider | null)[]>(() => {
    if (!this.auth.oauthOffered()) return [];
    const advertised = this.auth.oauthProviders();
    return advertised.length ? advertised : [null];
  });

  /** Locked for the same reasons the credential submit is, and while the IdP's pages are up. */
  protected readonly canUseOAuth = computed(
    () => !this.auth.needsReload() && !this.loggingIn() && !this.auth.oauthRunning(),
  );

  /** What an SSO button says: the provider's name where the repository gave one. */
  protected oauthLabel(provider: OAuthProvider | null): string {
    return provider ? `Anmelden mit ${provider.label}` : 'Anmelden mit OAuth';
  }

  protected togglePassword(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected async login(): Promise<void> {
    if (!this.canSubmit()) return;
    this.loggingIn.set(true);
    try {
      if (await this.auth.login(this.username(), this.password())) this.password.set('');
    } finally {
      this.loggingIn.set(false);
    }
  }

  protected logout(): Promise<void> {
    return this.auth.logout();
  }

  /**
   * The other way in: the identity provider's pages, then the token traded for a repository session
   * (see AuthService.loginWithOAuth). The typed password is dropped on success like the credential
   * login drops it — the session is there, and the field has nothing left to submit.
   */
  protected async loginWithOAuth(provider: OAuthProvider | null): Promise<void> {
    if (!this.canUseOAuth()) return;
    if (await this.auth.loginWithOAuth(provider ?? undefined)) this.password.set('');
  }

  /** Leaves the panel: the page is replaced and the panel comes back once it is there. */
  protected openRegister(): void {
    void this.repositoryPages.open(this.repositoryPages.registerUrl());
  }

  protected openPasswordReset(): void {
    void this.repositoryPages.open(this.repositoryPages.passwordResetUrl());
  }

}
