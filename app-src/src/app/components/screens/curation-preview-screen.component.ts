import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, viewChild
} from '@angular/core';

import { CurationService, DraftPreviewSource } from '../../services/curation.service';
import { EDITOR_MODE_FOR_DRAFT } from '../../util/mds-node';
import { MdsValues } from '../../util/mds-values';
import { MdsPreviewWidgetComponent, PreviewEditorMode } from '../mds-preview-widget.component';

// The second step of "Inhalt erschließen": the picture and the title of what was just read off the
// page, before anything of it is written.
//
// Both are rendered by the repository's own view group (`browser_extension_preview`, see
// MdsPreviewWidgetComponent) rather than by a form of our own — which widgets the step offers is the
// metadata set's decision, not the panel's. The content has no node yet, so the editor is fed the
// stand-in the curation assembles from the run (CurationService.draftNode).
//
// Nothing is saved here. The footer offers the two ways on: dropping the run, or carrying it into the
// step that follows — "Einsortieren und weiterleiten", or the Qualitätsprüfung where that one does
// not apply; the save is at the end of the latter (see ActionBarService). Both of the step's values travel
// with it: the title through the editor's own reporting, the picture through the preview source this
// screen registers — the widget announces it in no other way.
@Component({
  selector: 'es-curation-preview-screen',
  imports: [MdsPreviewWidgetComponent],
  templateUrl: './curation-preview-screen.component.html',
  styleUrl: './curation-preview-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurationPreviewScreenComponent implements OnInit, OnDestroy {
  private readonly curation = inject(CurationService);

  private readonly widget = viewChild(MdsPreviewWidgetComponent);

  /** Stable function, so register/clear pair up by identity. */
  private readonly previewSource: DraftPreviewSource = () =>
    this.widget()?.currentPreviewSrc() ?? null;

  /**
   * The node the editor works on, read ONCE as the screen is built: it is derived from the metadata
   * the editor itself reports back, and the wrapper re-initialises whenever its `nodes` change — so a
   * node that kept tracking would rebuild the form on every keystroke.
   */
  protected readonly draftNode = this.curation.draftNode();

  /** The step always works on the stand-in, so it always renders in its mode. */
  protected readonly editorMode: PreviewEditorMode = EDITOR_MODE_FOR_DRAFT;

  ngOnInit(): void {
    this.curation.registerDraftPreviewSource(this.previewSource);
  }

  ngOnDestroy(): void {
    this.curation.clearDraftPreviewSource(this.previewSource);
  }

  /** Hand every change to the curation, which applies it when this step is left. */
  protected onValuesChange(values: MdsValues): void {
    this.curation.reportDraftValues(values);
  }
}
