import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { CurationService } from '../../../services/curation.service';

/**
 * The way from the panel to the content's page in the repository, which shows everything the panel only selects
 * from. One component, so the way out reads the same wherever a screen names the content. It asks
 * {@link CurationService} for that content and renders nothing where there is none.
 */
@Component({
  selector: 'es-details-link',
  imports: [IconDirective],
  templateUrl: './details-link.component.html',
  styleUrl: './details-link.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DetailsLinkComponent {
  protected readonly curation = inject(CurationService);
}
