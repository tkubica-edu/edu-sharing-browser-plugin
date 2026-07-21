import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { GenerateService } from '../../services/generate.service';

// "Inhalt erschließen": intro/description only. The action ("Erschließung starten") lives
// in the footer action bar (FlowService), which runs /generate and advances to Metadaten.
@Component({
  selector: 'es-erschliessen-screen',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './erschliessen-screen.component.html',
  styleUrl: './screen.scss'
})
export class ErschliessenScreenComponent {
  readonly gen = inject(GenerateService);
}
