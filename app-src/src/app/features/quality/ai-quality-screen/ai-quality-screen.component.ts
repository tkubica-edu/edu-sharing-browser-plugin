import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CurationService } from '../../../services/curation.service';

// "Individuelle Qualitätsprüfung mit KI": the content analysed against the requirements of the collection it was
// filed in, as a dialogue — one of the two processes "Prüfprozess auswählen" offers. Nothing but its frame so far,
// which it says rather than showing an empty screen, and it names the content it would be about.
@Component({
  selector: 'es-ai-quality-screen',
  templateUrl: './ai-quality-screen.component.html',
  styleUrl: './ai-quality-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AiQualityScreenComponent {
  protected readonly curation = inject(CurationService);
}
