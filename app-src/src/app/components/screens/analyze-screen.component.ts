import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { GenerateService } from '../../services/generate.service';

// "Inhalt erschließen": intro/description only. The action ("Erschließung starten") lives
// in the footer action bar (FlowService), which runs /generate and advances to Metadaten.
@Component({
  selector: 'es-analyze-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analyze-screen.component.html',
  styleUrl: './analyze-screen.component.scss'
})
export class AnalyzeScreenComponent {
  readonly gen = inject(GenerateService);
}
