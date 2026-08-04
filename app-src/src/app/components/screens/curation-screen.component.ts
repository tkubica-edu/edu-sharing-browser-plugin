import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { MetadataAgentService } from '../../services/metadata-agent.service';

// "Inhalt erschließen": intro and last-run error only. The action ("Erschließung starten") lives
// in the footer (ActionBarService), which runs the metadata agent and advances to the
// Qualitätssicherung.
@Component({
  selector: 'es-curation-screen',
  templateUrl: './curation-screen.component.html',
  styleUrl: './curation-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CurationScreenComponent {
  protected readonly metadataAgent = inject(MetadataAgentService);
}
