import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CurationService } from '../../services/curation.service';
import { PreviewNodeComponent } from '../preview-node.component';

// "Vorschau": shows the active node with the embedded preview element. The footer's next
// step (Metadaten bearbeiten / Einsortieren) is chosen by FlowService from the state.
@Component({
  selector: 'es-preview-screen',
  standalone: true,
  imports: [CommonModule, PreviewNodeComponent],
  templateUrl: './preview-screen.component.html',
  styleUrl: './preview-screen.component.scss'
})
export class PreviewScreenComponent {
  readonly curation = inject(CurationService);
}
