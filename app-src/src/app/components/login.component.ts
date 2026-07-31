import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../services/auth.service';

// The shared login gate: the credential form while logged out, a compact status row once logged
// in. The repository session is shared, so signing in here unblocks every screen.
@Component({
  selector: 'es-login',
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly loggingIn = signal(false);

  protected readonly canSubmit = computed(
    () => !!this.username() && !!this.password() && !this.auth.needsReload() && !this.loggingIn(),
  );

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
}
