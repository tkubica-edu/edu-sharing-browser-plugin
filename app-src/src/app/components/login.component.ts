import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { IconDirective } from '../directives/icon.directive';
import { AuthService } from '../services/auth.service';
import { RepositoryPageService } from '../services/repository-page.service';

/**
 * What the login field takes. edu-sharing accepts either, and which of the two a person has been
 * given differs per instance — so the placeholder names both rather than asking for the one the
 * user may not have.
 */
const USER_PLACEHOLDER = 'E-Mail-Adresse oder Benutzername';

// The shared login gate: the credential form while logged out, a compact status row once logged
// in. The repository session is shared, so signing in here unblocks every screen.
//
// One form for both places it is asked for — the Login section, reached from the session bar, and a
// section a guest cannot be served by (LoginGateComponent). Only its two lines of text differ, so
// they are inputs.
//
// Registering and resetting a password are the repository's own forms; the panel opens them in the
// tab it is docked in (RepositoryPageService).
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

  /** Leaves the panel: the page is replaced and the panel comes back once it is there. */
  protected openRegister(): void {
    void this.repositoryPages.open(this.repositoryPages.registerUrl());
  }

  protected openPasswordReset(): void {
    void this.repositoryPages.open(this.repositoryPages.passwordResetUrl());
  }

}
