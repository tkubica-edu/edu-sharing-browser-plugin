import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { IconDirective } from '../directives/icon.directive';
import { BusyService } from '../services/busy.service';
import { NavigationService } from '../services/navigation.service';
import { OptionIconService } from '../services/option-icon.service';

// The open section's sub steps, as an icon-over-label tab row directly under the section title
// (e.g. Qualitätsprüfung → "Qualität" / "Metadaten"). Rendered only for a real choice —
// NavigationService.showTabs is the gate, so a single-step section shows no bar.
@Component({
  selector: 'es-tab-bar',
  imports: [IconDirective],
  templateUrl: './tab-bar.component.html',
  styleUrl: './tab-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TabBarComponent {
  protected readonly navigation = inject(NavigationService);
  protected readonly busy = inject(BusyService);
  protected readonly icons = inject(OptionIconService);
}
