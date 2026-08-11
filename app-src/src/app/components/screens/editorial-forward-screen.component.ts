import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { IconDirective } from '../../directives/icon.directive';
import { CurationService } from '../../services/curation.service';
import { EditorialGroup, EditorialGroupsService } from '../../services/editorial-groups.service';
import { NavigationService } from '../../services/navigation.service';
import { SpinnerComponent } from '../spinner.component';

// "An Redaktionen weiterleiten": where the curated content is handed to one or more editorial teams.
// Offered only where the repository config enables the additional web component (see the section in
// the navigation registry).
//
// The groups on offer are the collections the config names (EditorialGroupsService). Ticking one
// forwards the content to it; where a group has collections inside it, one of them is picked in the
// step behind "Sammlung auswählen" and the content then goes there instead (see EditorialTarget).
//
// Nothing is written here: the choice is held by the flow and carried out by the save at the end of
// the Qualitätsprüfung — which is also what creates the content in the first place, so this view
// works on a content that has no node yet (see CurationService.editorialTargets).
@Component({
  selector: 'es-editorial-forward-screen',
  imports: [IconDirective, SpinnerComponent],
  templateUrl: './editorial-forward-screen.component.html',
  styleUrl: './editorial-forward-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorialForwardScreenComponent {
  protected readonly curation = inject(CurationService);
  protected readonly groups = inject(EditorialGroupsService);

  private readonly navigation = inject(NavigationService);

  constructor() {
    // Reads the config and loads the collections once per session (see EditorialGroupsService.load).
    void this.groups.load();
  }

  /** Open the step that picks the collection this group's forwarding lands in. */
  protected selectCollection(group: EditorialGroup): void {
    this.groups.pick(group);
    this.navigation.go('select-collection');
  }
}
