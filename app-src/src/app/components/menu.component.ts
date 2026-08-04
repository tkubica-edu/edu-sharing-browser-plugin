import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { HistoryService } from '../services/history.service';
import { NavigationService } from '../services/navigation.service';
import { OptionIconService } from '../services/option-icon.service';

// The main menu: the sections marked `menu`, filtered to those visible for the current conditions.
// It is the start view everywhere — nothing opens itself, so what is on offer stays visible.
// Selecting an entry navigates to its section.
@Component({
  selector: 'es-menu',
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MenuComponent {
  protected readonly navigation = inject(NavigationService);
  protected readonly icons = inject(OptionIconService);
  // For the Verlauf entry's count badge.
  protected readonly history = inject(HistoryService);
}
