import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { CurationService } from '../../../services/curation.service';
import { EditorialGroupsService } from '../../../services/editorial-groups.service';
import { DetailsLinkComponent } from '../../../shared/components/details-link/details-link.component';
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

// "Interaktionen", the fourth sub step of the Inhaltsübersicht: what became of the content at the editorial
// teams it was proposed to — one card per team, with the exchange so far under it. A draft: the repository
// hands out no communication history yet, so the cards name the forwardings this flow really made while the
// exchange under them is an example of what will be shown there (marked as such in the template).
@Component({
  selector: 'es-interactions-screen',
  imports: [DatePipe, DetailsLinkComponent, IconDirective],
  templateUrl: './interactions-screen.component.html',
  styleUrl: './interactions-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InteractionsScreenComponent {
  protected readonly curation = inject(CurationService);
  private readonly groups = inject(EditorialGroupsService);

  constructor() {
    // The groups are what the pictures come from; loading is idempotent and usually done already, as
    // the forwarding step runs before this one (see EditorialGroupsService.load).
    void this.groups.load();
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
   * team that judges it.
   */
  protected readonly exchanges = computed<readonly EditorialExchange[]>(() => {
    const submitted = this.submittedAt();
    return this.curation.editorialTargets().map((target) => ({
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
