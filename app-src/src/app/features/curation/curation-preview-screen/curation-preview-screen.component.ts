import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, viewChild
} from '@angular/core';

import { CurationService, DraftPreviewSource } from '../../../services/curation.service';
import { EDITOR_MODE_FOR_DRAFT, isDraftNode } from '../../../util/mds-node';
import { MdsValues } from '../../../util/mds-values';
import { MdsPreviewWidgetComponent, PreviewEditorMode } from '../../metadata/mds-preview-widget/mds-preview-widget.component';

// The second step of "Inhalt erschließen": the picture and the title of what was just read off the page. Both are
// rendered by the repository's own view group rather than by a form of ours, so which widgets the step offers is
// the metadata set's decision; until the content is written the editor is fed the stand-in the curation assembles.
// This is where the content is written — the footer's way on saves the title the editor reports and the picture the
// preview source registered here announces. Everything behind this step edits that node, and so does coming back.
@Component({
  selector: 'es-curation-preview-screen',
  imports: [MdsPreviewWidgetComponent],
  templateUrl: './curation-preview-screen.component.html',
  styleUrl: './curation-preview-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurationPreviewScreenComponent implements OnInit, OnDestroy {
  /** Protected: the template reads the write's state and its error off it. */
  protected readonly curation = inject(CurationService);

  private readonly widget = viewChild(MdsPreviewWidgetComponent);

  /** Stable function, so register/clear pair up by identity. */
  private readonly previewSource: DraftPreviewSource = () =>
    this.widget()?.currentPreviewSrc() ?? null;

  /**
   * The node the editor works on, read once as the screen is built: it is derived from the metadata the editor
   * itself reports, and the wrapper re-initialises on every `nodes` change. The content's own node once this step
   * has written it, the stand-in before that — the step is returnable and has to show what was saved.
   */
  protected readonly editorNode = this.curation.editorNode();

  /**
   * The payload the node was built from, for its `_origins` — the picture and the title are the
   * agent's findings here, so this step is where saying so matters most. Read at the same moment as
   * the node, so the two agree about the content they describe.
   */
  protected readonly draftMetadata = this.curation.editorMetadata();

  /**
   * A form without a node behind it while the content is only a stand-in, and the node mode once it
   * has one — the mode is what tells the group's widgets which of the two they are editing (see
   * EDITOR_MODE_FOR_DRAFT).
   */
  protected readonly editorMode: PreviewEditorMode = isDraftNode(this.editorNode)
    ? EDITOR_MODE_FOR_DRAFT
    : 'nodes';

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
