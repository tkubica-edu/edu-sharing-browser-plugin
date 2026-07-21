import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { UiStateService } from '../services/ui-state.service';
import { AuthService } from '../services/auth.service';
import { CurationService } from '../services/curation.service';

// The persistent condition bar. Always visible, independent of the options — it shows the
// states the options' visibility is derived from (login, insert host, Edu-Sharing page,
// active node, edit mode) so the user can always see why options appear/disappear.
@Component({
  selector: 'es-status-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './status-bar.component.html',
  styleUrl: './status-bar.component.scss'
})
export class StatusBarComponent {
  readonly ui = inject(UiStateService);
  readonly auth = inject(AuthService);
  readonly curation = inject(CurationService);
}
