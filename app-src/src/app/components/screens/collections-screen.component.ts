import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { Collection, CurationService } from '../../services/curation.service';
import { CollectionSelectorComponent } from '../collection-selector.component';

// "Einsortieren in Sammlungen": the selector owns its apply action ("In Sammlung einfügen"), so
// there is no footer action — this screen only wires the selection through to CurationService.
@Component({
  selector: 'es-collections-screen',
  imports: [CollectionSelectorComponent],
  templateUrl: './collections-screen.component.html',
  styleUrl: './collections-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CollectionsScreenComponent {
  protected readonly curation = inject(CurationService);

  protected assign(collections: Collection[]): Promise<void> {
    return this.curation.assignToCollections(collections);
  }
}
