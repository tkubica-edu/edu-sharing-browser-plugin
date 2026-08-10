import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CurationService } from '../../services/curation.service';

// "Persönliche Ablage", the second sub step of "Einsortieren und weiterleiten": where the content is
// filed away in the user's own place. Offered only for a session of the user's own — a filing place
// is something a person has, see the `collections` section in the navigation registry.
//
// A placeholder for now — the component that picks the place is supplied later. Nothing is written
// here either: the content is created by the save that ends this step (ActionBarService).
@Component({
  selector: 'es-personal-storage-screen',
  templateUrl: './personal-storage-screen.component.html',
  styleUrl: './personal-storage-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PersonalStorageScreenComponent {
  protected readonly curation = inject(CurationService);
}
