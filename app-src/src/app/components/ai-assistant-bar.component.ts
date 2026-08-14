import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconDirective } from '../directives/icon.directive';
import { BrowserExtensionCustomWebComponentService } from '../services/browser-extension-custom-web-component.service';
import { AuthService } from '../services/auth.service';
import { BusyService } from '../services/busy.service';
import { NavigationService } from '../services/navigation.service';

/** What the assistant is called where it is offered. */
const ASSISTANT_NAME = 'Boerdi - KI-Assistent';

// The assistant's offer, sitting directly above the session bar at the panel's bottom edge: who is
// there to ask, and the way into asking them.
//
// Above the session bar rather than in the menu because it is not an action on the open content —
// it accompanies whatever the user is doing, the way the bar naming the session does. Like
// UserBarComponent (and ActionBarComponent) it decides for itself whether it is on screen, so the
// shell renders it unconditionally.
@Component({
  selector: 'es-ai-assistant-bar',
  imports: [IconDirective],
  templateUrl: './ai-assistant-bar.component.html',
  styleUrl: './ai-assistant-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiAssistantBarComponent {
  private readonly auth = inject(AuthService);
  private readonly webComponent = inject(BrowserExtensionCustomWebComponentService);
  private readonly navigation = inject(NavigationService);
  protected readonly busy = inject(BusyService);

  protected readonly name = ASSISTANT_NAME;

  /**
   * When the offer is shown — the session bar's own condition, plus the WLO context.
   *
   * The context is the browser extension custom web component, on the same condition its canvas
   * loads under: the assistant comes with that bundle, so where it is off there is nobody to ask.
   *
   * The rest mirrors UserBarComponent: the two bars share the bottom edge, and an offer that
   * outlived the bar under it would sit on top of a screen that owns its own edge (a form, an
   * embedded editor, the action bar).
   */
  protected readonly visible = computed(
    () =>
      this.webComponent.enabled() &&
      this.auth.authorized() &&
      (this.navigation.section() === 'menu' || !!this.navigation.currentSection()?.plain),
  );

  /** The row's tooltip; the row itself already names who is being asked. */
  protected readonly hint = computed(() => `Eine Frage an ${this.name} stellen`);

  protected ask(): void {
    this.navigation.go('ai-assistant');
  }

  protected hideBrokenAvatar(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
