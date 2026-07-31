import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';

import { MetadataAgentService } from '../../services/metadata-agent.service';
import { OnlyOfficeDocumentService } from '../../services/onlyoffice-document.service';

// "Metadaten anreichern": the OnlyOffice counterpart of the analyze screen — intro, the document
// that was detected, and the last error. The action ("Metadaten anreichern") lives in the footer
// (ActionBarService), which asks the plugin for the document content, runs the metadata agent on
// its markdown and advances to the metadata screen.
@Component({
  selector: 'es-enrich-screen',
  templateUrl: './enrich-screen.component.html',
  styleUrl: './enrich-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EnrichScreenComponent implements OnInit {
  protected readonly metadataAgent = inject(MetadataAgentService);
  protected readonly onlyOfficeDocument = inject(OnlyOfficeDocumentService);

  ngOnInit(): void {
    // The plugin announces the document once on startup, which is lost if the panel was opened
    // later. Ask for the identity instead of waiting for it — best effort, purely informational:
    // a missing answer only means the document line stays hidden.
    if (!this.onlyOfficeDocument.currentDocument()) {
      void this.onlyOfficeDocument.requestInfo().catch(() => null);
    }
  }
}
