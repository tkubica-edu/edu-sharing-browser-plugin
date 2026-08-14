import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { CurationService } from '../../../services/curation.service';
import { DetailsLinkComponent } from '../../../shared/components/details-link/details-link.component';
import { PreviewNodeComponent } from '../preview-node/preview-node.component';
import { ShareTeaserComponent } from '../share-teaser/share-teaser.component';
import { WloCanvasComponent } from '../../metadata/wlo-canvas/wlo-canvas.component';

// "Vorschau", the first sub step of the Inhaltsübersicht: shows the active node, with the footer's next steps from
// ActionBarService. Which preview is embedded depends on the repository config — the WLO canvas shows the
// properties read-only instead of the edu-sharing preview element, and since it renders the metadata fields only,
// the content's title and picture are supplied here.
@Component({
  selector: 'es-preview-screen',
  imports: [DetailsLinkComponent, PreviewNodeComponent, ShareTeaserComponent, WloCanvasComponent],
  templateUrl: './preview-screen.component.html',
  styleUrl: './preview-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreviewScreenComponent {
  protected readonly curation = inject(CurationService);
  protected readonly browserExtensionCustomWebComponent = inject(BrowserExtensionCustomWebComponentService);

  /** The content's title — see CurationService.contentTitle, which the menu reads too. */
  protected readonly title = this.curation.contentTitle;

  /**
   * The content's picture; `''` when there is none, which is what the WLO canvas reads as "no image". The bare type
   * icon is left out: this screen shows the node itself right below, so a generic glyph on top would say nothing.
   */
  protected readonly previewImage = computed(() => {
    const preview = this.curation.contentPreview();
    return preview && !preview.isIcon ? preview.url : '';
  });

  protected hideBrokenImage(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
