import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { BrowserExtensionCustomWebComponentService } from '../../../services/browser-extension-custom-web-component.service';
import { CurationService } from '../../../services/curation.service';
import { EditorialGroupsService } from '../../../services/editorial-groups.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { DetailsLinkComponent } from '../../../shared/components/details-link/details-link.component';
import { NostrReceiptComponent } from '../../../shared/components/nostr-receipt/nostr-receipt.component';
import { NostrStandingComponent } from '../../../shared/components/nostr-standing/nostr-standing.component';
import { createdAtOf } from '../../../util/curation-node';

/** One line of an exchange: what happened, when it is known, and whether it is still outstanding. */
interface CommunicationStep {
  icon: string;
  label: string;
  detail: string;
  /** The moment the step happened; null for one that names no moment of its own. */
  at: number | null;
  /** An outstanding step is where the exchange currently stands, and is drawn as such. */
  pending: boolean;
}

/**
 * The exchange with one editorial team about the content: which team, where inside it the content was
 * proposed, and what has happened since.
 */
interface EditorialExchange {
  id: string;
  group: string;
  /** The collection inside the group the content was proposed for; null where it went to the group itself. */
  folder: string | null;
  /** The group's own picture, `null` where the repository has none — see EditorialGroup.logoUrl. */
  logoUrl: string | null;
  steps: readonly CommunicationStep[];
}

// "Interaktionen", the fourth sub step of the Inhaltsübersicht: where the content went outside this panel.
//
// Two halves, each answering for itself. The editorial teams it was proposed to — one card per team, with the
// exchange so far under it, and a draft at that: the repository hands out no communication history yet, so the
// cards name the forwardings this flow really made while the exchange under them is an example of what will be
// shown there (marked as such in the template). And the nostr relay, which is not an exchange at all but a
// state: whether this content was published there, to which relay, under which identity (es-nostr-standing) —
// with the receipt of the publication under it where there was one. Only reported here; the step that acts on
// it is *An Nostr Relay senden*.
@Component({
  selector: 'es-interactions-screen',
  imports: [
    DatePipe, DetailsLinkComponent, IconDirective, NostrReceiptComponent, NostrStandingComponent
  ],
  templateUrl: './interactions-screen.component.html',
  styleUrl: './interactions-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InteractionsScreenComponent {
  protected readonly curation = inject(CurationService);
  // The other place this content was offered to, where the forwarding step published it there: a relay
  // hands back a receipt rather than an exchange, so it is shown as itself under the teams' cards.
  protected readonly nostr = inject(NostrForwardService);
  /**
   * Whether the editorial teams apply at all — the view is also opened by a publication to a relay alone (see the
   * registry), and the teams' half is then not merely empty but beside the point.
   */
  protected readonly teams = inject(BrowserExtensionCustomWebComponentService);
  private readonly groups = inject(EditorialGroupsService);

  constructor() {
    // The groups are what the pictures come from; loading is idempotent and usually done already, as
    // the forwarding step runs before this one (see EditorialGroupsService.load). Asked only where
    // there are teams: without them the view holds the relay's receipt alone.
    if (this.teams.enabled()) void this.groups.load();
    // What the relay holds about this content — the half of this view that is a state rather than an
    // exchange has nothing to report until it has been asked (see NostrForwardService.lookup).
    void this.curation.lookUpOnNostr();
  }

  /**
   * When the content was proposed: the node's creation, since the forwarding is carried out by the very
   * save that creates the node. Null for a content whose node states no date — the step then names no
   * moment rather than an invented one.
   */
  private readonly submittedAt = computed(() => createdAtOf(this.curation.previewNode()));

  /**
   * One exchange per editorial team the content was forwarded to, in the order the forwarding step listed
   * them. The user's own filing has no part in it: "Persönliche Ablage" is where a content is kept, not a
   * team that judges it. Read off the forwardings the content stands in rather than off the step's own
   * picks, so a content taken up from the Verlauf names its teams too (see
   * CurationService.contentForwardings).
   */
  protected readonly exchanges = computed<readonly EditorialExchange[]>(() => {
    const submitted = this.submittedAt();
    return this.curation.contentForwardings().map((target) => ({
      id: target.group.id,
      group: target.group.name,
      folder: target.folder?.name ?? null,
      logoUrl:
        this.groups.groups().find((group) => group.collection.id === target.group.id)?.logoUrl ??
        null,
      steps: [
        {
          icon: 'send',
          label: 'Vorschlag übermittelt',
          detail: 'Beim Speichern des Inhalts an die Redaktion übergeben',
          at: submitted,
          pending: false
        },
        {
          icon: 'mark_email_read',
          label: 'Eingang bestätigt',
          detail: 'Der Vorschlag liegt der Redaktion zur Prüfung vor',
          at: null,
          pending: false
        },
        {
          icon: 'hourglass_empty',
          label: 'Noch keine Entscheidung erhalten',
          detail: 'Die Redaktion hat den Vorschlag noch nicht bewertet',
          at: null,
          pending: true
        }
      ]
    }));
  });
}
