import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, viewChild } from '@angular/core';

import { MdsValues } from '../../../util/mds-values';
import { ActionBarService, SaveHandler } from '../../../services/action-bar.service';
import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { CurationService, DraftPreviewSource } from '../../../services/curation.service';
import { MetadataAgentService } from '../../../services/metadata-agent.service';
import { IconDirective } from '../../../directives/icon.directive';
import { MdsEditorComponent } from '../mds-editor/mds-editor.component';
import { MdsPreviewWidgetComponent } from '../mds-preview-widget/mds-preview-widget.component';
import { MetadataEditor } from '../../../model/metadata-editor';
import { WloCanvasComponent } from '../wlo-canvas/wlo-canvas.component';

// "Metadaten", the second view of the Qualitätsprüfung: embeds a metadata editor and hands its
// commit()/ready() to the footer, whose way on carries the save. Which editor is embedded depends on the
// repository config — the WLO canvas replaces the MDS editor while the browser extension custom web
// component is enabled, and both implement MetadataEditor.
@Component({
  selector: 'es-metadata-screen',
  imports: [IconDirective, MdsEditorComponent, MdsPreviewWidgetComponent, WloCanvasComponent],
  templateUrl: './metadata-screen.component.html',
  styleUrl: './metadata-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MetadataScreenComponent implements OnInit, OnDestroy {
  protected readonly metadataAgent = inject(MetadataAgentService);
  protected readonly curation = inject(CurationService);
  protected readonly browserExtensionCustomWebComponent = inject(BrowserExtensionCustomWebComponentService);
  private readonly actionBar = inject(ActionBarService);

  // Signal queries, so `canSave` tracks both which editor is rendered AND its ready() state.
  private readonly mdsEditor = viewChild(MdsEditorComponent);
  private readonly wloCanvas = viewChild(WloCanvasComponent);

  /** The preview widget above the editor, for the picture it shows — see {@link previewSource}. */
  private readonly previewWidget = viewChild(MdsPreviewWidgetComponent);

  private readonly editor = computed<MetadataEditor | undefined>(
    () => this.wloCanvas() ?? this.mdsEditor(),
  );

  /**
   * A page this editor should erschließen as it opens (an added link, see
   * AddMaterialScreenComponent). Taken over ONCE, at construction: the screen is rebuilt whenever
   * the sub step is re-entered, and re-extracting the page then would discard the user's edits.
   */
  protected readonly sourceUrl = this.curation.takeExtractionUrl();

  /**
   * The node the preview widget and the editor work on, read once for the same reason as `sourceUrl`: the
   * wrapper re-initialises on every `nodes` change, so a tracking node would rebuild the form on each
   * keystroke. Without one the editor falls back to a plain values map.
   */
  protected readonly editorNode = this.curation.editorNode();

  /**
   * The payload `editorNode` was built from, for the preview widget's `_origins` — which of the
   * fields it renders the metadata agent filled. Read at the same moment as the node, so the two
   * agree about the content they describe.
   */
  protected readonly editorMetadata = this.curation.editorMetadata();

  /**
   * What the preview widget last reported: the values of the group it renders, the content's file name
   * among them. Kept here rather than handed to the curation, because it is not a *finding* but the
   * answer to a question the form below asks as well — see {@link previewOverrides}.
   */
  private previewValues: MdsValues = {};

  /**
   * Settles the write the footer is waiting on; null while none is in flight. The editor announces its values
   * through an output, so commit and write are two hops apart and this carries the answer back.
   */
  private settleSave: ((saved: boolean) => void) | null = null;

  /**
   * Whether the write in flight is the one that *ends* this step — the footer's way on — rather than
   * a save the editor's own control asked for. Only the former hands the content over for review:
   * that is what leaving the last view of the flow means, and a save made to keep working is not it.
   */
  private finishing = false;

  /** Stable object, so register/clear pair up by identity. */
  private readonly saveHandler: SaveHandler = {
    save: () =>
      new Promise<boolean>((resolve) => {
        this.finishing = true;
        this.settleSave = resolve;
        this.editor()?.commit();
      }),
    canSave: computed(() => !!this.editor()?.ready())
  };

  /**
   * Lets the save pick up a picture the user swapped in the preview widget. Stable function, so register and
   * clear pair up by identity.
   */
  private readonly previewSource: DraftPreviewSource = () =>
    this.previewWidget()?.currentPreviewSrc() ?? null;

  ngOnInit(): void {
    this.actionBar.registerSaveHandler(this.saveHandler);
    this.curation.registerDraftPreviewSource(this.previewSource);
  }

  ngOnDestroy(): void {
    // A write that never reported back (the editor did not commit) is settled as "not saved", so
    // the footer action awaiting it ends instead of hanging on a screen that is gone.
    this.settleSave?.(false);
    this.settleSave = null;
    this.finishing = false;
    this.actionBar.clearSaveHandler(this.saveHandler);
    this.curation.clearDraftPreviewSource(this.previewSource);
  }

  /** Take over the preview widget's values, for the save to lay over the editor's. */
  protected onPreviewValuesChange(values: MdsValues): void {
    this.previewValues = values;
  }

  /**
   * The properties the preview widget answers rather than the editor below it, whose widgets for them are
   * hidden — so the visible field wins over the hidden one still reporting its seed. Empty values are
   * dropped: the widget reports its whole group, and a field it has nothing for must not erase the form's.
   */
  private previewOverrides(): MdsValues {
    return Object.fromEntries(
      Object.entries(this.previewValues).filter(([, value]) => value?.length),
    );
  }

  /**
   * Write the metadata and stay put; where the flow goes next is the footer's business, and the canvas has a
   * save control of its own that means no leaving. This is the step that describes the content, so the whole
   * payload and the WLO extended fields are written — and on the way out, the handover to the queue.
   */
  protected async save(values: MdsValues): Promise<void> {
    const finishing = this.finishing;
    this.finishing = false;
    // The editor's own payload travels with the values: it is what the content's metadata is read
    // back from once it is written (see CurationService.save).
    const saved = await this.curation.save(
      { ...values, ...this.previewOverrides() },
      this.editor()?.payload?.() ?? null,
      { metadata: true, review: finishing },
    );
    const settle = this.settleSave;
    this.settleSave = null;
    settle?.(saved);
  }
}
