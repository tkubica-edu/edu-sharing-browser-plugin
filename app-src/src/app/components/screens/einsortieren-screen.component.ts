import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CurationService } from '../../services/curation.service';
import { CollectionChoice, CollectionSelectorComponent } from '../collection-selector.component';

// "Einsortieren in Sammlungen": the collection selector owns its apply action ("In Sammlung
// einfügen"), so there is no footer primary — this screen just wires the selection through
// to CurationService.
@Component({
  selector: 'es-einsortieren-screen',
  standalone: true,
  imports: [CommonModule, CollectionSelectorComponent],
  templateUrl: './einsortieren-screen.component.html',
  styleUrl: './screen.scss'
})
export class EinsortierenScreenComponent {
  readonly curation = inject(CurationService);

  onAssign(collections: CollectionChoice[]): Promise<void> {
    return this.curation.assignToCollection(collections);
  }
}
