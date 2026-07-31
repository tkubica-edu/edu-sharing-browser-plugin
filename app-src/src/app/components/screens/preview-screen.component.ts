import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { AdditionalWebComponentService } from '../../services/additional-web-component.service';
import { CurationService } from '../../services/curation.service';
import { PreviewNodeComponent } from '../preview-node.component';
import { WloCanvasComponent } from '../wlo-canvas.component';

// "Vorschau": shows the active node after saving. The footer's next steps (edit metadata / add to
// a collection) come from ActionBarService.
//
// Which preview is embedded depends on the repository config: while the additional web component
// is enabled, the WLO canvas shows the properties read-only ('detail' mode) instead of the
// edu-sharing preview element.
@Component({
  selector: 'es-preview-screen',
  imports: [PreviewNodeComponent, WloCanvasComponent],
  templateUrl: './preview-screen.component.html',
  styleUrl: './preview-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreviewScreenComponent {
  protected readonly curation = inject(CurationService);
  protected readonly additionalWebComponent = inject(AdditionalWebComponentService);
}
