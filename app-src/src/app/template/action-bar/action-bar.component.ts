import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ActionBarService } from '../../services/action-bar.service';
import { BusyService } from '../../services/busy.service';

// The persistent footer: renders the current view's next steps (ActionBarService.actions) and hides itself when
// there are none. Every action is refused while a write is in flight, here rather than per action — the one that
// started the write says so itself, its neighbours would still lead away from it.
@Component({
  selector: 'es-action-bar',
  templateUrl: './action-bar.component.html',
  styleUrl: './action-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActionBarComponent {
  protected readonly actionBar = inject(ActionBarService);
  protected readonly busy = inject(BusyService);
}
