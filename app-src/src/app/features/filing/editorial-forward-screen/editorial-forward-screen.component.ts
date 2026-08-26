import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { BusyService } from '../../../services/busy.service';
import { CurationService } from '../../../services/curation.service';
import { EditorialGroup, EditorialGroupsService } from '../../../services/editorial-groups.service';
import { NavigationService } from '../../../services/navigation.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { NostrReceiptComponent } from '../../../shared/components/nostr-receipt/nostr-receipt.component';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';

// "An Redaktionen weiterleiten": where the curated content is offered on. Two kinds of target, each shown where it
// applies, so the screen is a list of one or of both:
//
//   - The editorial teams, which belong to the browser extension custom web component: the collections the config
//     names, and where a team's collection has collections inside it one is picked in the step behind it. Nothing
//     is written here — the choice is carried out by the save the way on makes, which is also what creates the node.
//   - A nostr relay, which belongs to no repository: the content's metadata as an AMB record, published openly (see
//     NostrForwardService). Offered everywhere, and so the only target the base version has.
@Component({
  selector: 'es-editorial-forward-screen',
  imports: [IconDirective, NostrReceiptComponent, SpinnerComponent],
  templateUrl: './editorial-forward-screen.component.html',
  styleUrl: './editorial-forward-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EditorialForwardScreenComponent {
  protected readonly curation = inject(CurationService);
  protected readonly groups = inject(EditorialGroupsService);
  /**
   * Whether the editorial teams are on offer at all. The step is reached without them — the relay below them is
   * every repository's — and then it shows the relay alone rather than an empty list under a heading promising
   * Redaktionen.
   */
  protected readonly teams = inject(BrowserExtensionCustomWebComponentService);
  // The way on writes what this screen picked, so the picking is closed while that write runs — see
  // BusyService, which the shell's own controls are disabled by for the same reason.
  protected readonly busy = inject(BusyService);
  // The relay row below the teams: what is ticked there, what the publication answered, and where it went.
  protected readonly nostr = inject(NostrForwardService);

  private readonly navigation = inject(NavigationService);

  constructor() {
    // Reads the config and loads the collections once per session (see EditorialGroupsService.load),
    // then has a collection proposed for the content from its keywords — once per content, and only
    // once the groups are there to take the proposal over for. Asked only where the teams are shown:
    // without them both requests answer a list nothing renders.
    if (this.teams.enabled()) {
      void this.groups.load();
      void this.groups.recommendCollection();
    }
  }

  /**
   * Open the step that picks the collection this group's forwarding lands in. Refused while a write is
   * in flight: navigation is refused then anyway (NavigationService.go), and the group would be left
   * marked as the one being picked for without any step opening on it.
   */
  protected selectCollection(group: EditorialGroup): void {
    if (this.busy.busy()) return;
    this.groups.pick(group);
    this.navigation.go('select-collection');
  }
}
