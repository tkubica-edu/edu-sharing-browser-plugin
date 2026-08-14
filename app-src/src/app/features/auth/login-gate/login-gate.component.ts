import { ChangeDetectionStrategy, Component } from '@angular/core';

import { LoginComponent } from '../login/login.component';

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
  protected readonly lead =
    'Melde dich an, um diese Funktion zu nutzen. Anschließend kannst du direkt dort weitermachen, wo du aufgehört hast.';
}
