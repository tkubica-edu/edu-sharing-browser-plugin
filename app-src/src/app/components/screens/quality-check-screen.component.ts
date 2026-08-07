import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CurationService } from '../../services/curation.service';

// "Qualität", the first of the Qualitätsprüfung's two views: what the content's quality is, before
// the metadata are worked on in the second.
//
// A scaffold — the view is in place, its checks are not: what is reported here (and by whom) is not
// decided yet, so the screen names the content it applies to and says outright that the report
// follows. Nothing here writes, so the step can be walked through in either direction meanwhile.
@Component({
  selector: 'es-quality-check-screen',
  templateUrl: './quality-check-screen.component.html',
  styleUrl: './quality-check-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class QualityCheckScreenComponent {
  protected readonly curation = inject(CurationService);
}
