import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CurationService } from '../../services/curation.service';
import { PreviewNodeComponent } from '../preview-node.component';

// "Vorschau": shows the active node with the embedded preview element. The footer's next
// step (Metadaten bearbeiten / Einsortieren) is chosen by FlowService from the state.
@Component({
  selector: 'es-vorschau-screen',
  standalone: true,
  imports: [CommonModule, PreviewNodeComponent],
  templateUrl: './vorschau-screen.component.html',
  styleUrl: './screen.scss'
})
export class VorschauScreenComponent {
  readonly curation = inject(CurationService);
}
