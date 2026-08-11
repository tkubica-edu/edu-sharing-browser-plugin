import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ActionBarService } from '../services/action-bar.service';
import { BusyService } from '../services/busy.service';

// The persistent footer: renders the current view's next steps (ActionBarService.actions).
// Hidden when there is none, e.g. on screens that own their own action.
//
// Every action is refused while a write is in flight, here rather than per action: the one that
// STARTED the write says so itself ("Speichern…"), but its neighbours — the way back out of the step,
// an "Abbrechen" — would otherwise still lead away from it.
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
