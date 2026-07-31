import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { NavigationService } from '../services/navigation.service';
import { OptionIconService } from '../services/option-icon.service';

// The "Aktionen & Optionen" list: the flow-agnostic options, filtered to those visible for the
// current conditions. Selecting one navigates to its screen. The utility options (Verlauf,
// Einstellungen) are not listed here — they live as icons in the topbar.
@Component({
  selector: 'es-menu',
  templateUrl: './menu.component.html',
  styleUrl: './menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MenuComponent {
  protected readonly navigation = inject(NavigationService);
  protected readonly icons = inject(OptionIconService);
}
