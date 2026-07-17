import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../services/auth.service';
import { GenerateService } from '../services/generate.service';
import { CurationService } from '../services/curation.service';
import { MdsEditorComponent } from './mds-editor.component';
import { PreviewNodeComponent } from './preview-node.component';
import { CollectionChoice, CollectionSelectorComponent } from './collection-selector.component';

@Component({
  selector: 'es-analyze',
  standalone: true,
  imports: [CommonModule, FormsModule, MdsEditorComponent, PreviewNodeComponent, CollectionSelectorComponent],
  templateUrl: './analyze.component.html',
  styleUrl: './analyze.component.scss'
})
export class AnalyzeComponent {
  readonly auth = inject(AuthService);
  readonly gen = inject(GenerateService);
  readonly wiz = inject(CurationService);

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

  start(): Promise<void> {
    return this.wiz.run();
  }

  onSave(values: Record<string, string[]>): Promise<void> {
    return this.wiz.save(values);
  }

  onAssign(collections: CollectionChoice[]): Promise<void> {
    return this.wiz.assignToCollection(collections);
  }
}
