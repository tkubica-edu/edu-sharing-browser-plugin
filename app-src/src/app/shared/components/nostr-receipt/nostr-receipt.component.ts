import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { IconDirective } from '../../../directives/icon.directive';
import { NostrForwardService } from '../../../services/nostr-forward.service';

/** One line of the "was wurde gesendet" table: the tag's key and the value under it. */
interface TagLine {
  key: string;
  value: string;
}

/** One way of looking the record up again, as the command or address that does it. */
interface Lookup {
  label: string;
  /** What to run or open; copyable as it stands. */
  value: string;
  /** What it answers, so the reader can pick the one that fits what they want to know. */
  detail: string;
  /** Set where the value is an address rather than a command, and so can be opened from here. */
  href?: string;
}

/**
 * What was published to the nostr relay, as the receipt of it: which relay took it, under which identity,
 * which fields went out, and how to fetch the record back. Rendered wherever the publication is spoken
 * about — the forwarding step it is made from, and the Interaktionen view that collects what became of a
 * content — so the answer to "was ist da rausgegangen?" reads the same in both places.
 *
 * It shows the event as it was actually sent rather than a description of it: a receipt that has been
 * summarised is the one thing that cannot be checked against the relay.
 */
@Component({
  selector: 'es-nostr-receipt',
  imports: [IconDirective],
  templateUrl: './nostr-receipt.component.html',
  styleUrl: './nostr-receipt.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NostrReceiptComponent {
  protected readonly nostr = inject(NostrForwardService);

  /** Which value was last copied, so the button that copied it can say so; `null` while none was. */
  protected readonly copied = signal<string | null>(null);

  /** The event's tags as they went over the wire — this *is* the published record. */
  protected readonly tagLines = computed<readonly TagLine[]>(
    () =>
      this.nostr.receipt()?.event.tags.map((tag) => ({
        key: tag[0],
        // A tag is a list; everything after the key is the value, and the `p`/`a` tags put a relay hint
        // and a role there. Joined rather than dropped, so nothing published is hidden here.
        value: tag.slice(1).filter(Boolean).join(' · ')
      })) ?? []
  );

  /** The whole event as JSON, formatted — what a relay stores, byte for byte. */
  protected readonly eventJson = computed(() => {
    const receipt = this.nostr.receipt();
    return receipt ? JSON.stringify(receipt.event, null, 2) : '';
  });

  /**
   * The ways of reading the record back off the relay, from the narrowest to the widest: this exact
   * event, the record's standing address, everything this panel has published, and the page a nostr
   * client renders it on.
   */
  protected readonly lookups = computed<readonly Lookup[]>(() => {
    const receipt = this.nostr.receipt();
    if (!receipt) return [];
    return [
      {
        label: 'Dieses Event holen',
        value: `nak fetch ${receipt.nevent}`,
        detail:
          'Die Referenz trägt das Relay in sich, nak verbindet sich also selbst dorthin. ' +
          'nak ist das Kommandozeilenwerkzeug für Nostr (github.com/fiatjaf/nak).'
      },
      {
        label: 'Den aktuellen Stand holen',
        value: `nak fetch ${receipt.naddr}`,
        detail:
          'Die Adresse des Eintrags statt dieses einen Events: Wird derselbe Inhalt später erneut ' +
          'gesendet, antwortet sie mit dem neueren Event.'
      },
      {
        label: 'Alles von dieser Installation',
        value: `nak req -k 30142 -a ${receipt.event.pubkey} ${receipt.relayUrl}`,
        detail: 'Alle AMB-Einträge, die dieses Panel unter seinem Schlüssel veröffentlicht hat.'
      },
      {
        label: 'Ohne Werkzeug, nur WebSocket',
        value:
          `echo '["REQ","pruefung",{"ids":["${receipt.event.id}"]}]' | websocat ${receipt.relayUrl}`,
        detail: 'Dasselbe roh über das Protokoll — das Relay antwortet mit EVENT und danach EOSE.'
      },
      {
        label: 'Im Browser ansehen',
        value: `https://njump.me/${receipt.nevent}`,
        detail: 'Ein Nostr-Client, der das Event anhand der Referenz sucht und darstellt.',
        href: `https://njump.me/${receipt.nevent}`
      }
    ];
  });

  /** Put a value on the clipboard and mark it as copied — the commands are made to be run elsewhere. */
  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(value);
    } catch {
      // Copying is a convenience; the value is on screen and selectable either way.
    }
  }
}
