import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconDirective } from '../../directives/icon.directive';
import { SectionId } from '../../model/navigation';
import { BrowserExtensionCustomWebComponentService } from '../../services/browser-extension-custom-web-component.service';
import { AuthService } from '../../services/auth.service';
import { BusyService } from '../../services/busy.service';
import { NavigationService } from '../../services/navigation.service';

/** What the assistant is called where it is offered. */
const ASSISTANT_NAME = 'Boerdi - KI-Assistent';

/** The section the offer leads to, and the one place it is not shown. */
const ASSISTANT_SECTION: SectionId = 'ai-assistant';

// The assistant's offer, directly above the session bar: who is there to ask, and the way into asking them. Above
// that bar rather than in the menu because it is not an action on the open content. Like the other bars it decides
// for itself whether it is on screen.
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
   * When the offer is shown: the session bar's own condition plus the WLO context, on the same condition the canvas
   * loads under — the assistant comes with that bundle. An offer that outlived the bar under it would sit on top of
   * a screen that owns its own bottom edge.
   */
  protected readonly visible = computed(
    () =>
      this.webComponent.enabled() &&
      this.auth.authorized() &&
      // Not under the login gate: it brings the panel's bottom edge itself (LoginGateComponent).
      !this.navigation.sessionGate() &&
      // Not on the assistant's own screen: the offer is the way *into* asking, and there the asking
      // is what is on screen.
      this.navigation.section() !== ASSISTANT_SECTION &&
      (this.navigation.section() === 'menu' || !!this.navigation.currentSection()?.plain),
  );

  /** The row's tooltip; the row itself already names who is being asked. */
  protected readonly hint = computed(() => `Eine Frage an ${this.name} stellen`);

  protected ask(): void {
    this.navigation.go(ASSISTANT_SECTION);
  }

  protected hideBrokenAvatar(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
