import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, viewChild } from '@angular/core';
import { JsonPipe } from '@angular/common';

import { MdsValues } from '../../util/mds-values';
import { ActionBarService, SaveHandler } from '../../services/action-bar.service';
import { AdditionalWebComponentService } from '../../services/additional-web-component.service';
import { ConditionsService } from '../../services/conditions.service';
import { CurationService, DraftPreviewSource } from '../../services/curation.service';
import { MetadataAgentService } from '../../services/metadata-agent.service';
import { NavigationService } from '../../services/navigation.service';
import { MdsEditorComponent } from '../mds-editor.component';
import { MdsPreviewWidgetComponent } from '../mds-preview-widget.component';
import { MetadataEditor } from '../metadata-editor';
import { WloCanvasComponent } from '../wlo-canvas.component';

// "Metadaten", the second view of the Qualitätsprüfung: embeds a metadata editor and hands its
// commit()/ready() to the footer (ActionBarService), whose way on takes the values out of it —
// written straight away where this is the end of the big step, held for the save at the end of it
// where "Einsortieren und weiterleiten" still follows (see SaveHandler).
//
// Which editor is embedded depends on the repository config: the WLO canvas replaces the
// edu-sharing MDS editor while the additional web component is enabled. Both implement
// MetadataEditor, so everything else on this screen is identical either way.
@Component({
  selector: 'es-metadata-screen',
  imports: [JsonPipe, MdsEditorComponent, MdsPreviewWidgetComponent, WloCanvasComponent],
  templateUrl: './metadata-screen.component.html',
  styleUrl: './metadata-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MetadataScreenComponent implements OnInit, OnDestroy {
  protected readonly metadataAgent = inject(MetadataAgentService);
  protected readonly curation = inject(CurationService);
  protected readonly additionalWebComponent = inject(AdditionalWebComponentService);
  private readonly actionBar = inject(ActionBarService);
  private readonly conditions = inject(ConditionsService);
  private readonly navigation = inject(NavigationService);

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
   * The node both the preview widget and the MDS editor work on, read ONCE for the same reason as
   * `sourceUrl`: the wrapper re-initialises whenever its `nodes` change, so a node that kept tracking
   * would rebuild the form on every keystroke. Without it the editor falls back to editing a plain
   * values map — and the widgets that insist on a node, `<preview>` among them, render not at all.
   */
  protected readonly editorNode = this.curation.editorNode();

  /**
   * What the preview widget last reported: the values of the group it renders, the content's file name
   * among them. Kept here rather than handed to the curation, because it is not a *finding* but the
   * answer to a question the form below asks as well — see {@link previewOverrides}.
   */
  private previewValues: MdsValues = {};

  /**
   * Settles the commit the footer is waiting on; null while none is in flight.
   *
   * The editor announces its values through an output rather than returning them, so the commit and
   * what is done with the values are two hops apart — this carries the answer back across them.
   */
  private settleSave: ((saved: boolean) => void) | null = null;

  /**
   * What the pending commit does with the values. Null means writing them, which is what a commit
   * the footer did not ask for is: the WLO canvas has a save control of its own
   * ({@link WloCanvasComponent.onMetadataSubmit}), and that one means to save.
   */
  private sink: ((values: MdsValues) => Promise<boolean>) | null = null;

  /** Stable object, so register/clear pair up by identity. */
  private readonly saveHandler: SaveHandler = {
    save: () => this.commit(null),
    collect: () =>
      this.commit(async (values) => {
        await this.curation.hold(values);
        return true;
      }),
    canSave: computed(() => !!this.editor()?.ready())
  };

  /**
   * Lets the save pick up a picture the user swapped in the preview widget — the one element of this
   * screen that shows the picture, in every context. Stable function, so register/clear pair up by
   * identity: the same arrangement the preview step makes
   * (CurationService.registerDraftPreviewSource).
   */
  private readonly previewSource: DraftPreviewSource = () =>
    this.previewWidget()?.currentPreviewSrc() ?? null;

  ngOnInit(): void {
    this.conditions.editMode.set(true);
    this.actionBar.registerSaveHandler(this.saveHandler);
    this.curation.registerDraftPreviewSource(this.previewSource);
  }

  ngOnDestroy(): void {
    // A commit that never reported back (the editor did not commit) is settled as "not done", so
    // the footer action awaiting it ends instead of hanging on a screen that is gone.
    this.settleSave?.(false);
    this.settleSave = null;
    this.sink = null;
    this.conditions.editMode.set(false);
    this.actionBar.clearSaveHandler(this.saveHandler);
    this.curation.clearDraftPreviewSource(this.previewSource);
  }

  /** Take over the preview widget's values, for the save to lay over the editor's. */
  protected onPreviewValuesChange(values: MdsValues): void {
    this.previewValues = values;
  }

  /**
   * The properties the preview widget answers rather than the editor below it: the widgets for them
   * are hidden in that form (see mds-editor.component.scss), so the visible field is the one the user
   * edited — while the hidden one keeps reporting the value it was seeded with.
   *
   * Empty values are dropped: the widget reports its whole group, and a field it has nothing for must
   * not erase what the form carries.
   */
  private previewOverrides(): MdsValues {
    return Object.fromEntries(
      Object.entries(this.previewValues).filter(([, value]) => value?.length),
    );
  }

  /**
   * Ask the editor for its values and answer what became of them — the one hop the footer awaits.
   * `sink` decides what that is; see {@link save}.
   */
  private commit(sink: ((values: MdsValues) => Promise<boolean>) | null): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.settleSave = resolve;
      this.sink = sink;
      this.editor()?.commit();
    });
  }

  /**
   * Take the committed values wherever the pending commit wants them, and stay put. Where the flow
   * goes next is the footer's business, not this screen's.
   *
   * Writing is the default, because the editor also reaches here through a save control of the
   * canvas's own (WloCanvasComponent.onMetadataSubmit) — that one saves without meaning to leave.
   */
  protected async save(values: MdsValues): Promise<void> {
    const all = { ...values, ...this.previewOverrides() };
    const sink = this.sink;
    this.sink = null;
    const done = sink ? await sink(all) : await this.curation.save(all);
    const settle = this.settleSave;
    this.settleSave = null;
    settle?.(done);
  }

  /** Drop the content's picture when it cannot be loaded; nothing takes its place here. */
  protected hideBrokenImage(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
