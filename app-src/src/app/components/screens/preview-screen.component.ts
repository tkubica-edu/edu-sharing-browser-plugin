import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { AdditionalWebComponentService } from '../../services/additional-web-component.service';
import { CurationService } from '../../services/curation.service';
import { PreviewNodeComponent } from '../preview-node.component';
import { WloCanvasComponent } from '../wlo-canvas.component';

/** First string of a metadata value, which the payloads carry as a scalar or as an array. */
function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' && value.trim() ? value : null;
}

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

  /**
   * The content's title: its `cclom:title` if the metadata carries one, else the node's own title,
   * else its name (the file name). Never the node id — an id is not a title.
   */
  protected readonly title = computed(() => {
    const metadata = this.curation.editorMetadata();
    return (
      firstString(metadata?.['cclom:title']) ??
      firstString(this.curation.previewNode()?.title) ??
      firstString(this.curation.activeNode()?.name)
    );
  });

  /** The preview image the agent found for the content, if any. */
  protected readonly previewImage = computed(() => {
    const metadata = this.curation.editorMetadata();
    return (
      firstString(metadata?.['preview_image_url']) ?? firstString(metadata?.['preview:url']) ?? ''
    );
  });

  protected hideBrokenImage(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
