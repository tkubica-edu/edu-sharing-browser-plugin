import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { CurationService } from '../../../services/curation.service';
import { NostrForwardService } from '../../../services/nostr-forward.service';
import { toAmbResource } from '../../../util/amb-event';
import { NostrReceiptComponent } from '../../../shared/components/nostr-receipt/nostr-receipt.component';
import { NostrStandingComponent } from '../../../shared/components/nostr-standing/nostr-standing.component';

/**
 * "An Nostr Relay senden": publishing a content the panel already has, as a step of its own. The same
 * publication the forwarding step makes on its way on (see NostrForwardService), reached from the
 * Inhaltsoptionen for a content that is past that step — one taken up from the Verlauf, from *Meine
 * Inhalte*, or detected on the open page.
 *
 * It only ever publishes what the content already says: no field is edited here, so the screen names the
 * three things that decide whether the record can be written at all — the address, the title, and how much
 * of the rest is there — and leaves the sending to the footer.
 */
@Component({
  selector: 'es-nostr-forward-screen',
  imports: [NostrReceiptComponent, NostrStandingComponent],
  templateUrl: './nostr-forward-screen.component.html',
  styleUrl: './nostr-forward-screen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NostrForwardScreenComponent {
  protected readonly curation = inject(CurationService);
  protected readonly nostr = inject(NostrForwardService);

  /**
   * The record as it would go out, built from the content exactly as the send does. `null` where AMB has
   * nothing to identify the resource by — an address and a title — which is the one refusal that can be
   * answered before anything is sent, and so is said before rather than after.
   */
  protected readonly record = computed(() => toAmbResource(this.curation.ambSource()));

  /** How many fields of the record are filled beyond the two AMB requires, so the row says what it carries. */
  protected readonly fieldCount = computed(() => {
    const record = this.record();
    // `id`, `name` and `type` are the record's identity rather than what it says about the content.
    return record ? Object.keys(record).length - 3 : 0;
  });
}
