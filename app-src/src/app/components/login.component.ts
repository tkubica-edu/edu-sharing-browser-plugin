import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../services/auth.service';

// Shared login gate used by BOTH primary features (Erschließen, Inhalt suchen).
// Renders the credential form while logged out and a compact status row once
// logged in. The repository session is shared, so signing in here immediately
// unblocks every tab. Login/logout state lives in AuthService.
@Component({
  selector: 'es-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  readonly auth = inject(AuthService);

  username = '';
  password = '';
  // Signal so the "Anmelden…" state refreshes under zoneless change detection
  // (it is toggled after an await, outside any template event or signal write).
  readonly loggingIn = signal(false);

  async login(): Promise<void> {
    if (!this.username || !this.password || this.auth.state().needsReload) return;
    this.loggingIn.set(true);
    try {
      const ok = await this.auth.login(this.username, this.password);
      if (ok) this.password = '';
    } finally {
      this.loggingIn.set(false);
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }
}
