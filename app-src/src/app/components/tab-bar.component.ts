import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { NavigationService } from '../services/navigation.service';
import { OptionIconService } from '../services/option-icon.service';

// The open section's sub steps, as an icon-over-label tab row directly under the section title
// (e.g. Qualitätssicherung → "Metadaten bearbeiten" / "Inhalte zuordnen"). Rendered only for a
// real choice — NavigationService.showTabs is the gate, so a single-step section shows no bar.
@Component({
  selector: 'es-tab-bar',
  templateUrl: './tab-bar.component.html',
  styleUrl: './tab-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TabBarComponent {
  protected readonly navigation = inject(NavigationService);
  protected readonly icons = inject(OptionIconService);
}
