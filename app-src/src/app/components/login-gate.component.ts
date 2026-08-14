import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { NavigationService } from '../services/navigation.service';
import { LoginComponent } from './login.component';

/**
 * What a section shows instead of its screen while the panel has no session of its own to serve it
 * with — see AppSection.requiresSession and NavigationService.sessionGate.
 *
 * The login itself, not a refusal: the section was entered on purpose, so what is owed is the way to
 * doing it rather than the news that it cannot be done. It is the same form as the Login section's
 * (LoginComponent), under the two lines that say why it is being asked for here.
 *
 * Nothing has to be entered again afterwards: the session is what the section was missing, so the
 * moment it exists the screen behind this one renders — the gate is a condition, not a step.
 *
 * The way back is the gate's own, because the section's footer belongs to the screen that is not on
 * display (see ActionBarService).
 */
@Component({
  selector: 'es-login-gate',
  imports: [LoginComponent],
  templateUrl: './login-gate.component.html',
  styleUrl: './login-gate.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginGateComponent {
  protected readonly navigation = inject(NavigationService);

  protected readonly lead =
    'Melde dich an, um diese Funktion zu nutzen. Anschließend kannst du direkt dort weitermachen, wo du aufgehört hast.';
}
