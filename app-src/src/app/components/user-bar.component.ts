import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { IconDirective } from '../directives/icon.directive';
import { AuthorityNamePipe } from '../pipes/authority-name.pipe';
import { AuthService } from '../services/auth.service';
import { NavigationService } from '../services/navigation.service';

// The bottom bar naming who the panel is acting as, and where that session is changed: signing in,
// signing out. It is about the session rather than about the open page, hence the bottom edge instead
// of the status bar's row of page conditions.
//
// Like ActionBarComponent it decides for itself whether it is on screen (see {@link visible}), so the
// shell renders it unconditionally.
@Component({
  selector: 'es-user-bar',
  imports: [IconDirective],
  templateUrl: './user-bar.component.html',
  styleUrl: './user-bar.component.scss',
  providers: [AuthorityNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserBarComponent {
  private readonly auth = inject(AuthService);
  private readonly navigation = inject(NavigationService);
  private readonly authorityName = inject(AuthorityNamePipe);

  /**
   * When the bar is shown:
   *
   * - `authorized`, so the case without a required login counts too — "as a guest" is an answer as
   *   much as a name is.
   * - a screen that is a plain list (AppSection.plain); elsewhere the bottom edge belongs to the
   *   screen, or to the action bar.
   *
   * The main menu is named separately: it is the root view and has no entry in `SECTIONS`.
   */
  protected readonly visible = computed(
    () =>
      this.auth.authorized() &&
      (this.navigation.section() === 'menu' || !!this.navigation.currentSection()?.plain),
  );

  /**
   * No session of the user's own: the repository lets the panel work without a login, so there is a
   * guest where the name would be — and {@link login} is still on offer.
   */
  protected readonly guest = computed(() => !this.auth.loggedIn());

  /** What the bar says, in the two states it has. */
  protected readonly title = computed(() => (this.guest() ? 'Gastzugang' : 'Angemeldet'));
  /**
   * Who the session belongs to, said the way the repository says it everywhere else — the profile's
   * name via {@link AuthorityNamePipe}, not the login name. The login name is the fallback the pipe
   * itself ends on, and what is shown while the person record is still on its way (or did not come).
   */
  protected readonly subtitle = computed(() => {
    if (this.guest()) return 'Kein Login erforderlich';
    const user = this.auth.currentUser();
    const name = user ? this.authorityName.transform(user) : null;
    return (name === 'invalid' ? null : name) || this.auth.username() || '–';
  });

  /** The row's tooltip: what folding it out would offer. */
  protected readonly hint = computed(() => {
    if (this.expanded()) return 'Schließen';
    return this.guest()
      ? 'Ohne Anmeldung unterwegs — hier anmelden'
      : `Angemeldet als ${this.subtitle()}`;
  });

  /** The session's actions are folded away until asked for — the bar itself is the answer. */
  protected readonly expanded = signal(false);

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

  /**
   * Sign in although nothing demands it — a guest only sees the repository's public view. Opens the
   * login screen, which falls away once the session exists, so the guard returns to the menu.
   */
  protected login(): void {
    this.expanded.set(false);
    this.navigation.go('login');
  }

  protected logout(): void {
    this.expanded.set(false);
    void this.auth.logout();
  }
}
