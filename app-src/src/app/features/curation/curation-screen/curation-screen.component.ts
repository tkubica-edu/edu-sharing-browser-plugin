import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CurationService } from '../../../services/curation.service';
import { MetadataAgentService } from '../../../services/metadata-agent.service';
import { NavigationService } from '../../../services/navigation.service';
import { CurationProgressComponent } from '../curation-progress/curation-progress.component';

// "Inhalt erschließen": runs the metadata agent on the open page and hands its result to the next step. Entering
// the section is the start — there is nothing to choose here, so a click in front of it would repeat what picking
// the entry already said. While it runs the screen is the waiting animation; a failure stays here with the error
// and the footer's retry. Hence `oneWay` in the registry: stepping back in would start another run.
@Component({
  selector: 'es-curation-screen',
  imports: [CurationProgressComponent],
  templateUrl: './curation-screen.component.html',
  styleUrl: './curation-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurationScreenComponent {
  protected readonly metadataAgent = inject(MetadataAgentService);
  protected readonly curation = inject(CurationService);
  private readonly navigation = inject(NavigationService);

  constructor() {
    void this.start();
  }

  /**
   * Run the agent and continue with its result. Never on top of a run that is already going — the
   * footer offers the same action, and a second run would throw away the first one's answer.
   */
  protected async start(): Promise<void> {
    if (this.curation.running()) return;
    if (await this.curation.analyze()) this.navigation.go('curation-preview');
  }
}
