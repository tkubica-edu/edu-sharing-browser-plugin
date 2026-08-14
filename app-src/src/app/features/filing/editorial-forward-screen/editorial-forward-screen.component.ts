import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { CurationService } from '../../../services/curation.service';
import { EditorialGroup, EditorialGroupsService } from '../../../services/editorial-groups.service';
import { NavigationService } from '../../../services/navigation.service';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';

// "An Redaktionen weiterleiten": where the curated content is handed to one or more editorial teams, offered only
// where the browser extension custom web component is enabled. The groups on offer are the collections the config
// names; where a group has collections inside it, one is picked in the step behind it. Nothing is written here —
// the choice is carried out by the save at the end of the Qualitätsprüfung, which is also what creates the node.
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
