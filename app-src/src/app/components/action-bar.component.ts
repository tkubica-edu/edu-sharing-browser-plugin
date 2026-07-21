import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { FlowService } from '../services/flow.service';

// The persistent footer. Renders the current screen's "logical next step" (FlowService.next):
// an optional labeled back button + a primary action button. Hidden when there is no next
// step (screens that own their own action, e.g. Einsortieren / Suchen).
@Component({
  selector: 'es-action-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './action-bar.component.html',
  styleUrl: './action-bar.component.scss'
})
export class ActionBarComponent {
  readonly flow = inject(FlowService);
}
