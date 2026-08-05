import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CurationService } from '../../services/curation.service';
import { MetadataAgentService } from '../../services/metadata-agent.service';
import { NavigationService } from '../../services/navigation.service';
import { CurationProgressComponent } from '../curation-progress.component';

// "Inhalt erschließen": runs the metadata agent on the open page and hands its result to the
// Qualitätssicherung.
//
// Entering the section IS the start — there is nothing to choose or fill in here, so a click in
// front of it would only be a step the user has already taken by picking the entry. While it runs,
// the screen is the waiting animation (CurationProgressComponent); on success the panel moves on to
// the Qualitätssicherung, and a failure stays here with the error and the footer's retry.
//
// Because of that, "Inhalt erschließen" is marked `oneWay` in the navigation registry: stepping back
// into a screen that starts a run would take the user straight forward again.
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
    if (await this.curation.analyze()) this.navigation.go('quality');
  }
}
