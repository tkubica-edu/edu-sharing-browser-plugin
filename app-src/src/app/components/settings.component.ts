import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../services/auth.service';
import { APP_CONFIG } from '../config';

@Component({
  selector: 'es-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent {
  readonly auth = inject(AuthService);

  repoUrl = this.auth.state().repositoryUrl;
  touched = false;

  onRepoChange(): void {
    this.touched = true;
    this.auth.setRepositoryUrl(this.repoUrl.trim());
  }

  applyRepo(): void {
    this.auth.applyRepositoryChange();
  }

  resetDefault(): void {
    this.repoUrl = APP_CONFIG.defaultRepositoryUrl;
    this.touched = true;
    this.auth.setRepositoryUrl(this.repoUrl);
  }
}
