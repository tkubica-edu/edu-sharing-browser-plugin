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

// "Metadaten bearbeiten", the first sub step of the Qualitätssicherung: embeds a metadata editor
// and hands its commit()/ready() to the footer (ActionBarService), which owns the save button.
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

  private readonly editor = computed<MetadataEditor | undefined>(
    () => this.wloCanvas() ?? this.mdsEditor(),
  );

  /** The node whose own preview the native MDS widget can show; null when there is none. */
  protected readonly nodeWithPreview = computed(() => {
    const node = this.curation.previewNode();
    return node?.preview?.url ? node : null;
  });

  /**
   * A page this editor should erschließen as it opens (an added link, see
   * AddMaterialScreenComponent). Taken over ONCE, at construction: the screen is rebuilt whenever
   * the sub step is re-entered, and re-extracting the page then would discard the user's edits.
   */
  protected readonly sourceUrl = this.curation.takeExtractionUrl();

  /**
   * The node the MDS editor works on, read ONCE for the same reason as `sourceUrl`: the wrapper
   * re-initialises whenever its `nodes` change, so a node that kept tracking would rebuild the form
   * on every keystroke. Without it the editor falls back to editing a plain values map — and its
   * `<preview>` widget, which insists on a node, would not render at all.
   */
  protected readonly editorNode = this.curation.editorNode();

  /** Stable object, so register/clear pair up by identity. */
  private readonly saveHandler: SaveHandler = {
    save: () => this.editor()?.commit(),
    canSave: computed(() => !!this.editor()?.ready())
  };

  /**
   * Lets the save pick up a picture the user swapped in the editor's own preview widget. Stable
   * function, so register/clear pair up by identity — the same arrangement the preview step makes
   * (CurationService.registerDraftPreviewSource).
   */
  private readonly previewSource: DraftPreviewSource = () =>
    this.mdsEditor()?.currentPreviewSrc() ?? null;

  ngOnInit(): void {
    this.conditions.editMode.set(true);
    this.actionBar.registerSaveHandler(this.saveHandler);
    this.curation.registerDraftPreviewSource(this.previewSource);
  }

  ngOnDestroy(): void {
    this.conditions.editMode.set(false);
    this.actionBar.clearSaveHandler(this.saveHandler);
    this.curation.clearDraftPreviewSource(this.previewSource);
  }

  /**
   * Save, then move on to the next sub step ("Inhalte zuordnen"): saving the metadata is what
   * finishes this step, so the Qualitätssicherung continues where it leads — also for a node that
   * existed beforehand (an added material, a document found open), where the next step was open
   * all along and staying put would leave the save looking like it did nothing.
   *
   * The section itself is never left — the footer's "Zur Inhaltsübersicht" is the way out, and the
   * editor stays editable via the tab bar.
   */
  protected async save(values: MdsValues): Promise<void> {
    if (!(await this.curation.save(values))) return;
    this.navigation.goNextTab();
  }

  /** Drop the content's picture when it cannot be loaded; nothing takes its place here. */
  protected hideBrokenImage(event: Event): void {
    (event.target as HTMLImageElement).style.display = 'none';
  }
}
