import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { IconDirective } from '../directives/icon.directive';
import { CurationService } from '../services/curation.service';

/**
 * The way from the panel to the content's page in the repository: the panel shows a selection of what
 * is known about a content, that page shows all of it. Wherever a screen names the content, this is
 * the line under the name — one component, so the way out reads and looks the same everywhere.
 *
 * The content is not passed in — every place that shows the link means the panel's active content, so
 * it asks {@link CurationService} for it. Without one there is nothing to link to and nothing is
 * rendered.
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
