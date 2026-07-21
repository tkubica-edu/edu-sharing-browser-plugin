import { Component, OnDestroy, OnInit, effect, inject, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

import { GenerateService } from '../../services/generate.service';
import { CurationService } from '../../services/curation.service';
import { FlowService } from '../../services/flow.service';
import { NavigationService } from '../../services/navigation.service';
import { UiStateService } from '../../services/ui-state.service';
import { MdsEditorComponent } from '../mds-editor.component';

// "Metadaten editieren": embeds the MDS editor and bridges its commit()/ready() to the
// shell footer (FlowService), which owns the "Speichern" button. On a successful save it
// advances to Vorschau.
@Component({
  selector: 'es-metadaten-screen',
  standalone: true,
  imports: [CommonModule, MdsEditorComponent],
  templateUrl: './metadaten-screen.component.html',
  styleUrl: './screen.scss'
})
export class MetadatenScreenComponent implements OnInit, OnDestroy {
  readonly gen = inject(GenerateService);
  readonly curation = inject(CurationService);
  private readonly flow = inject(FlowService);
  private readonly nav = inject(NavigationService);
  private readonly ui = inject(UiStateService);

  // Signal query (NOT @ViewChild): reading it in the effect tracks both the query result
  // AND the editor's `ready` signal, so `flow.canPrimary` stays in sync once the editor
  // mounts — the same reason analyze.component used a signal viewChild for canSave.
  private readonly mdsEditor = viewChild(MdsEditorComponent);

  // Stable handler so registerPrimary/clearPrimary pair up.
  private readonly commit = () => this.mdsEditor()?.commit();

  constructor() {
    // Mirror the editor's ready() into the footer's enabled state.
    effect(() => this.flow.canPrimary.set(!!this.mdsEditor()?.ready()));
  }

  ngOnInit(): void {
    this.ui.editMode.set(true);
    this.flow.registerPrimary(this.commit);
  }

  ngOnDestroy(): void {
    this.ui.editMode.set(false);
    this.flow.clearPrimary(this.commit);
  }

  async onSave(values: Record<string, string[]>): Promise<void> {
    const ok = await this.curation.save(values);
    if (ok) this.nav.go('vorschau');
  }
}
