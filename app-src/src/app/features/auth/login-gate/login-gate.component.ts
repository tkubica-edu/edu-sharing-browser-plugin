import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { ConditionsService } from '../../../services/conditions.service';
import { LoginComponent } from '../login/login.component';

/** Why the section asks for a session, addressed to the user; the default is the section itself. */
const LEAD =
  'Melde dich an, um diese Funktion zu nutzen. Anschließend kannst du direkt dort weitermachen, wo du aufgehört hast.';

/**
 * The wording for the one reason that is about the content rather than about the section: it was
 * created too long ago for the panel's own session to still write it.
 */
const LEAD_EDIT_WINDOW_CLOSED =
  'Dieser Inhalt wurde vor längerer Zeit angelegt und kann ohne Anmeldung nicht mehr bearbeitet werden. Melde dich an, um dort weiterzumachen, wo du aufgehört hast.';

/**
 * What a section shows instead of its screen while the panel has no session of its own — the login rather than a
 * refusal, since the section was entered on purpose. A condition, not a step: the screen behind it renders the
 * moment the session exists. Also the fallback a screen renders where it insists on a session of its own.
 */
@Component({
  selector: 'es-login-gate',
  imports: [LoginComponent],
  templateUrl: './login-gate.component.html',
  styleUrl: './login-gate.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginGateComponent {
  private readonly conditions = inject(ConditionsService);

  protected readonly lead = computed(() =>
    this.conditions.agentEditWindowClosed() ? LEAD_EDIT_WINDOW_CLOSED : LEAD,
  );
}
