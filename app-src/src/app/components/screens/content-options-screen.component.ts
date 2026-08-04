import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { SectionId } from '../../model/navigation';
import { ContentFlowService } from '../../services/content-flow.service';
import { CurationService } from '../../services/curation.service';
import { OptionIconService } from '../../services/option-icon.service';

/** One way on from a known content. `icon` names the step it leads to. */
interface ContentOption {
  icon: SectionId;
  label: string;
  description: string;
  run: () => void | Promise<void>;
}

// "Inhaltsoptionen": the junction for a node the app already has — detected on the page (a
// DOCUMENT_INFO from the OnlyOffice plugin), picked from the Verlauf, or picked from den eigenen
// Inhalten. It offers the two ways on as main-menu-style rows; where "Inhalt bearbeiten" leads is
// decided by the connector (see ContentFlowService), not here.
@Component({
  selector: 'es-content-options-screen',
  templateUrl: './content-options-screen.component.html',
  styleUrl: './content-options-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContentOptionsScreenComponent {
  protected readonly curation = inject(CurationService);
  protected readonly flow = inject(ContentFlowService);
  protected readonly icons = inject(OptionIconService);

  protected readonly options: readonly ContentOption[] = [
    {
      icon: 'editing',
      label: 'Inhalt bearbeiten',
      description: 'Im Connector bearbeiten oder direkt zur Qualitätssicherung',
      run: () => this.flow.edit()
    },
    {
      icon: 'overview',
      label: 'Inhaltsübersicht anzeigen',
      description: 'Vorschau, Aufrufe und Nutzung des Inhalts ansehen',
      run: () => this.flow.showOverview()
    }
  ];
}
