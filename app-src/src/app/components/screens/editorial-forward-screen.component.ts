import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { CurationService } from '../../services/curation.service';

// "An Redaktionen weiterleiten", the first sub step of "Einsortieren und weiterleiten": where the
// curated content is handed to an editorial team. Offered only where the repository config enables
// the additional web component (see the `collections` section in the navigation registry).
//
// A placeholder for now — the component that does the forwarding is supplied later. What already
// holds is where it sits in the flow: nothing is written here, the content is created by the save
// that ends this step (ActionBarService), so this view works on a content that has no node yet.
@Component({
  selector: 'es-editorial-forward-screen',
  templateUrl: './editorial-forward-screen.component.html',
  styleUrl: './editorial-forward-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorialForwardScreenComponent {
  protected readonly curation = inject(CurationService);
}
