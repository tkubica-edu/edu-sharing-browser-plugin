import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../services/auth.service';
import { GenerateService } from '../services/generate.service';
import { ErschliessenService } from '../services/erschliessen.service';
import { MdsEditorComponent } from './mds-editor.component';

@Component({
  selector: 'es-analyze',
  standalone: true,
  imports: [CommonModule, FormsModule, MdsEditorComponent],
  templateUrl: './analyze.component.html',
  styleUrl: './analyze.component.scss'
})
export class AnalyzeComponent {
  readonly auth = inject(AuthService);
  readonly gen = inject(GenerateService);
  readonly wiz = inject(ErschliessenService);

  username = '';
  password = '';
  loggingIn = false;

  async login(): Promise<void> {
    if (!this.username || !this.password || this.auth.state().needsReload) return;
    this.loggingIn = true;
    try {
      const ok = await this.auth.login(this.username, this.password);
      if (ok) this.password = '';
    } finally {
      this.loggingIn = false;
    }
  }

  async logout(): Promise<void> {
    await this.auth.logout();
  }

  start(): Promise<void> {
    return this.wiz.run();
  }

  onSave(values: Record<string, string[]>): Promise<void> {
    return this.wiz.save(values);
  }
}
