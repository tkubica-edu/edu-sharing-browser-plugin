import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, viewChild } from '@angular/core';
import { JsonPipe } from '@angular/common';

import { MdsValues } from '../../util/mds-values';
import { ActionBarService, SaveHandler } from '../../services/action-bar.service';
import { AdditionalWebComponentService } from '../../services/additional-web-component.service';
import { ConditionsService } from '../../services/conditions.service';
import { CurationService } from '../../services/curation.service';
import { MetadataAgentService } from '../../services/metadata-agent.service';
import { NavigationService } from '../../services/navigation.service';
import { MdsEditorComponent } from '../mds-editor.component';
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
  imports: [JsonPipe, MdsEditorComponent, WloCanvasComponent],
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

  /** Stable object, so register/clear pair up by identity. */
  private readonly saveHandler: SaveHandler = {
    save: () => this.editor()?.commit(),
    canSave: computed(() => !!this.editor()?.ready())
  };

  ngOnInit(): void {
    this.conditions.editMode.set(true);
    this.actionBar.registerSaveHandler(this.saveHandler);
  }

  ngOnDestroy(): void {
    this.conditions.editMode.set(false);
    this.actionBar.clearSaveHandler(this.saveHandler);
  }

  /**
   * Save, then move on to the sub step the save just unlocked ("Inhalte zuordnen", which needs the
   * node this save created). Read *before* the save, so this only advances when saving is what
   * unlocked it: re-saving an existing node, whose siblings were open all along, stays put.
   *
   * The section itself is never left — the footer's "Zur Inhaltsübersicht" is the way out.
   */
  protected async save(values: MdsValues): Promise<void> {
    const nextWasLocked = this.navigation.nextTab()?.disabled ?? false;
    if (!(await this.curation.save(values))) return;
    if (nextWasLocked) this.navigation.goNextTab();
  }
}
