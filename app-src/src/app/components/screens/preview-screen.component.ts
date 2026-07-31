import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CurationService } from '../../services/curation.service';
import { PreviewNodeComponent } from '../preview-node.component';

// "Vorschau": shows the active node with the embedded preview element. The footer's next steps
// (edit metadata / add to a collection) come from ActionBarService.
@Component({
  selector: 'es-preview-screen',
  imports: [PreviewNodeComponent],
  templateUrl: './preview-screen.component.html',
  styleUrl: './preview-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreviewScreenComponent {
  protected readonly curation = inject(CurationService);
}
