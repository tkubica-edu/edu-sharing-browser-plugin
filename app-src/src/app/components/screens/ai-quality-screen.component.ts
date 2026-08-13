import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CurationService } from '../../services/curation.service';

// "Individuelle Qualitätsprüfung mit KI": the content analysed against the requirements of the
// collection it was filed in, answered as a dialogue — one of the two processes offered by
// "Prüfprozess auswählen" (FlowChoiceScreenComponent).
//
// Nothing but its frame so far — the analysis and the dialogue are still to be built. It says so
// rather than showing an empty screen, and names the content it would be about, so the step is
// recognisable as the one that was chosen. The way back is the footer's (ActionBarService).
@Component({
  selector: 'es-ai-quality-screen',
  templateUrl: './ai-quality-screen.component.html',
  styleUrl: './ai-quality-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiQualityScreenComponent {
  protected readonly curation = inject(CurationService);
}
