import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AuthService } from '../services/auth.service';
import { ConditionsService } from '../services/conditions.service';
import { CurationService } from '../services/curation.service';
import { DebugService } from '../services/debug.service';

// The persistent condition bar. Always visible, independent of the options — it shows the states
// the options' visibility is derived from (login, insert host, Edu-Sharing page, active node,
// edit mode) so the user can always see why options appear or disappear.
@Component({
  selector: 'es-status-bar',
  templateUrl: './status-bar.component.html',
  styleUrl: './status-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StatusBarComponent {
  protected readonly conditions = inject(ConditionsService);
  protected readonly auth = inject(AuthService);
  protected readonly curation = inject(CurationService);
  protected readonly debug = inject(DebugService);

  protected logout(): void {
    void this.auth.logout();
  }

  // Drop the active content from the app state (deselect). Does NOT delete the repository node;
  // node-dependent options disappear and the navigation guard re-lands.
  protected clearActiveContent(): void {
    this.curation.startNew();
  }
}
