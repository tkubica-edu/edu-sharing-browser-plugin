import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { ActionBarService } from '../services/action-bar.service';

// The persistent footer: renders the current view's next steps (ActionBarService.actions).
// Hidden when there is none, e.g. on screens that own their own action.
@Component({
  selector: 'es-action-bar',
  templateUrl: './action-bar.component.html',
  styleUrl: './action-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ActionBarComponent {
  protected readonly actionBar = inject(ActionBarService);
}
