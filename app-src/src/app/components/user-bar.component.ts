import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { AuthService } from '../services/auth.service';
import { NavigationService } from '../services/navigation.service';

// The bottom bar naming who the panel is acting as. That is the one fact about the *session* rather
// than about the open page, which is why it sits at the bottom edge and not in the status bar's row
// of page conditions. It is also where that session is changed: signing in, signing out.
//
// It decides for itself whether it is on screen (see {@link visible}), like ActionBarComponent does:
// the shell renders it unconditionally and the conditions live in one place.
@Component({
  selector: 'es-user-bar',
  templateUrl: './user-bar.component.html',
  styleUrl: './user-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserBarComponent {
  private readonly auth = inject(AuthService);
  private readonly navigation = inject(NavigationService);

  /**
   * When the bar is shown. Two conditions:
   *
   * - **The panel may work with the repository at all** — `authorized`, so it also covers the case
   *   where no login is required (the additional web component); then there is no user, but the
   *   answer "as a guest" is just as much part of the picture as a name would be.
   * - **A screen that is a plain list** — see AppSection.plain. On a form, an editor or an embedded
   *   selector the bottom edge belongs to the screen (and in three sections to the action bar, which
   *   would otherwise sit under a second footer).
   *
   * The main menu is named separately because it is the root view and has no entry in `SECTIONS`,
   * so there is nothing there to carry the flag.
   */
  protected readonly visible = computed(
    () =>
      this.auth.authorized() &&
      (this.navigation.section() === 'menu' || !!this.navigation.currentSection()?.plain),
  );

  /**
   * No session of the user's own: the repository lets the panel work without a login (see
   * AuthService.authorized), so there is a guest where the name would be — and signing in is still
   * on offer, which is what {@link login} is for.
   */
  protected readonly guest = computed(() => !this.auth.loggedIn());

  /** What the bar says, in the two states it has. */
  protected readonly title = computed(() => (this.guest() ? 'Gastzugang' : 'Angemeldet'));
  protected readonly subtitle = computed(() =>
    this.guest() ? 'Kein Login erforderlich' : this.auth.username() || '–',
  );

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
   * Sign in although nothing demands it: a guest works with the repository's public view, and the
   * user's own contents and permissions only come with their own session. Opens the login screen,
   * which stays reachable for exactly this case (see the `login` section's visibility) — and once the
   * session exists it falls away again, so the navigation guard returns the user to the menu.
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
