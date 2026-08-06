import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CurationService } from '../../services/curation.service';
import { MdsValues } from '../../util/mds-values';
import { MdsPreviewWidgetComponent } from '../mds-preview-widget.component';

// The second step of "Inhalt erschließen": the picture and the title of what was just read off the
// page, before anything of it is written.
//
// Both are rendered by the repository's own view group (`browser_extension_preview`, see
// MdsPreviewWidgetComponent) rather than by a form of our own — which widgets the step offers is the
// metadata set's decision, not the panel's. The content has no node yet, so the editor is fed the
// stand-in the curation assembles from the run (CurationService.draftNode).
//
// Nothing is saved here. The footer offers the two ways on: dropping the run, or carrying it into the
// Qualitätssicherung, where the save lives (see ActionBarService).
@Component({
  selector: 'es-curation-preview-screen',
  imports: [MdsPreviewWidgetComponent],
  templateUrl: './curation-preview-screen.component.html',
  styleUrl: './curation-preview-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurationPreviewScreenComponent {
  private readonly curation = inject(CurationService);

  /**
   * The node the editor works on, read ONCE as the screen is built: it is derived from the metadata
   * the editor itself reports back, and the wrapper re-initialises whenever its `nodes` change — so a
   * node that kept tracking would rebuild the form on every keystroke.
   */
  protected readonly draftNode = this.curation.draftNode();

  /** Hand every change to the curation, which applies it when this step is left. */
  protected onValuesChange(values: MdsValues): void {
    this.curation.reportDraftValues(values);
  }
}
