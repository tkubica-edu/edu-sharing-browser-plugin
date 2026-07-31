import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { MetadataAgentService } from '../../services/metadata-agent.service';

// "Inhalt erschließen": intro and last-run error only. The action ("Erschließung starten") lives
// in the footer (ActionBarService), which runs the metadata agent and advances to the metadata
// screen.
@Component({
  selector: 'es-analyze-screen',
  templateUrl: './analyze-screen.component.html',
  styleUrl: './analyze-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AnalyzeScreenComponent {
  protected readonly metadataAgent = inject(MetadataAgentService);
}
