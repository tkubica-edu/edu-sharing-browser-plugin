import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AdditionalWebComponentService } from '../../services/additional-web-component.service';
import { CurationService } from '../../services/curation.service';
import { PreviewNodeComponent } from '../preview-node.component';
import { WloCanvasComponent } from '../wlo-canvas.component';

// "Vorschau", the first sub step of the Inhaltsübersicht: shows the active node. The footer's next
// steps come from ActionBarService.
//
// Which preview is embedded depends on the repository config: while the additional web component is
// enabled, the WLO canvas shows the properties read-only ('detail' mode) instead of the edu-sharing
// preview element. That canvas renders the metadata fields only, so the content's title and its
// preview image are supplied here — otherwise the preview never names what is being shown.
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

  /** The content's title — see CurationService.contentTitle, which the menu reads too. */
  protected readonly title = this.curation.contentTitle;

  /**
   * The content's picture (see CurationService.contentPreview); `''` when there is none — that is
   * what the WLO canvas' `previewImage` input reads as "no image".
   *
   * The repository's bare *type* icon is left out here: this screen is the content's own page and
   * shows the node itself right below, so a generic type glyph on top of it would say nothing.
   */
  protected readonly previewImage = computed(() => {
    const preview = this.curation.contentPreview();
    return preview && !preview.isIcon ? preview.url : '';
  });

  protected hideBrokenImage(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
