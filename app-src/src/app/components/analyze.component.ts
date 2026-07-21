import { Component, ElementRef, Input, computed, effect, inject, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AuthService } from '../services/auth.service';
import { GenerateService } from '../services/generate.service';
import { CurationService, WizardStep } from '../services/curation.service';
import { LoginComponent } from './login.component';
import { MdsEditorComponent } from './mds-editor.component';
import { PreviewNodeComponent } from './preview-node.component';
import { CollectionChoice, CollectionSelectorComponent } from './collection-selector.component';

/** Availability of a wizard sub-tab, surfaced as a progress mark. */
type StepStatus = 'done' | 'available' | 'locked';

@Component({
  selector: 'es-analyze',
  standalone: true,
  imports: [CommonModule, LoginComponent, MdsEditorComponent, PreviewNodeComponent, CollectionSelectorComponent],
  templateUrl: './analyze.component.html',
  styleUrl: './analyze.component.scss'
})
export class AnalyzeComponent {
  readonly auth = inject(AuthService);
  readonly gen = inject(GenerateService);
  readonly wiz = inject(CurationService);
  private readonly host = inject(ElementRef<HTMLElement>);

  // Signal query (NOT @ViewChild): reading it in `canSave` tracks both the query
  // result AND the editor's `ready` signal, so the button re-enables reactively once
  // the editor mounts. A plain @ViewChild would short-circuit on the initial undefined
  // and never re-evaluate → the Speichern button would stay permanently disabled.
  private readonly mdsEditor = viewChild(MdsEditorComponent);

  // True when the active tab is Edu-Sharing itself → show a context note, not the wizard.
  @Input() onEduSharing = false;

  // Footer "Speichern" (step 2) is enabled once the embedded editor is mounted and no
  // save is in flight. Works for both the Erschließung and the Verlauf-load paths,
  // since the editor mounts (editorMetadata is truthy) in both.
  readonly canSave = computed(() => !!this.mdsEditor()?.ready() && !this.wiz.saving());

  // Sub-tab definitions, rendered with a per-step progress mark.
  readonly stepDefs: { n: WizardStep; label: string }[] = [
    { n: 1, label: 'Erschließen' },
    { n: 2, label: 'Metadaten' },
    { n: 3, label: 'Vorschau' },
    { n: 4, label: 'Zuordnen' }
  ];

  constructor() {
    // Every step change resets the body scroll to the top, so the flow is driven by
    // the sub-tabs and the floating footer rather than by where the user happens to be
    // scrolled (the MDS editor and preview can be tall).
    effect(() => {
      this.wiz.step();
      queueMicrotask(() => this.scrollTop());
    });
  }

  private scrollTop(): void {
    const body = (this.host.nativeElement as HTMLElement).querySelector('.step-body') as HTMLElement | null;
    body?.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  // Progress mark per sub-tab: 'done' once its output exists, 'available' when it can
  // be opened, 'locked' until its prerequisite is met.
  stepStatus(step: WizardStep): StepStatus {
    const hasResult = this.wiz.hasResult();
    const hasNode = this.wiz.hasNode();
    switch (step) {
      case 1: return hasResult ? 'done' : 'available';
      case 2: return hasNode ? 'done' : hasResult ? 'available' : 'locked';
      case 3: return hasNode ? (this.wiz.previewConfirmed() ? 'done' : 'available') : 'locked';
      case 4: return this.wiz.assignedCollections().length ? 'done' : hasNode ? 'available' : 'locked';
    }
  }

  start(): Promise<void> {
    return this.wiz.run();
  }

  // Footer "Speichern" (step 2): trigger the embedded editor's save.
  saveFromEditor(): void {
    this.mdsEditor()?.commit();
  }

  onSave(values: Record<string, string[]>): Promise<void> {
    return this.wiz.save(values);
  }

  onAssign(collections: CollectionChoice[]): Promise<void> {
    return this.wiz.assignToCollection(collections);
  }
}
