import { Injectable, computed, inject, signal } from '@angular/core';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';

import { APP_CONFIG } from '../config';
import { AmbResource, AmbSource, AMB_KIND, toAmbEvent, toAmbResource } from '../util/amb-event';
import { errorMessage } from '../util/errors';
import { RelayAck, SignedNostrEvent, isRelayUrl, publishToRelay } from '../util/nostr-relay';
import { BrowserExtensionService } from './browser-extension.service';

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][nostr]';

/**
 * What one publication left behind: the event as it went over the wire, the relay's verdict on it, and
 * the names under which it can be looked up again. Kept whole rather than summarised — the point of the
 * receipt is that the user can check what was published, and a summary is exactly what cannot be checked.
 */
export interface NostrReceipt {
  /** The relay it went to. */
  relayUrl: string;
  /** Whether the relay kept it, and what it said — see {@link RelayAck}. */
  accepted: boolean;
  message: string;
  /** When the publication was made, as the panel's clock reads it. */
  at: number;
  /** The AMB record that was published, before it became tags. */
  resource: AmbResource;
  /** The signed event exactly as it was sent. */
  event: SignedNostrEvent;
  /** The publishing identity as nostr writes it (NIP-19). */
  npub: string;
  /** The event itself, as a shareable reference carrying the relay it is on. */
  nevent: string;
  /**
   * The *address* of the record: kind, publisher and identifier. A kind-30142 event is addressable, so
   * this is the name that keeps pointing at the current version of this resource's record — a later
   * publication of the same resource replaces the event but not this address.
   */
  naddr: string;
}

/**
 * "An Nostr Relay weiterleiten": the content's metadata as an AMB record, signed and published to a nostr
 * relay. The step it belongs to is the forwarding to the editorial teams — a relay is one more place the
 * content is offered to, and it is offered there the same way: ticked in that step, carried out by the way
 * on out of it.
 *
 * Nostr identifies a publisher by a key pair and by nothing else. The panel holds one of its own, generated
 * on the first publication and then kept in this browser's storage: it is what makes every record this
 * installation publishes findable as one publisher's, and what a relay's operator would allow-list.
 */
@Injectable({ providedIn: 'root' })
export class NostrForwardService {
  private readonly browserExtension = inject(BrowserExtensionService);

  /**
   * Whether the step is to publish to the relay. Ticked in the forwarding step and read by its way on;
   * a statement about one content, so it goes when that content does (see {@link reset}).
   */
  private readonly selectedState = signal(false);
  readonly selected = this.selectedState.asReadonly();

  /** Set while the publication runs — the row is locked by it, like the groups are by the save. */
  private readonly sendingState = signal(false);
  readonly sending = this.sendingState.asReadonly();

  /** Why the publication did not happen; `null` while nothing failed. */
  private readonly errorState = signal<string | null>(null);
  readonly error = this.errorState.asReadonly();

  /** What the last publication of the active content left behind; `null` until there was one. */
  private readonly receiptState = signal<NostrReceipt | null>(null);
  readonly receipt = this.receiptState.asReadonly();

  /** The relay the settings name; empty while they name none, and the configured default then stands. */
  private readonly relayState = signal('');

  /** The relay a publication would go to — the settings', else what the panel ships with. */
  readonly relayUrl = computed(() => this.relayState().trim() || APP_CONFIG.nostrRelayUrl);

  /** What the settings field shows: what was entered there, not the default standing behind it. */
  readonly configuredRelayUrl = this.relayState.asReadonly();

  /** Whether the relay address can be one — see {@link isRelayUrl}. */
  readonly relayUsable = computed(() => isRelayUrl(this.relayUrl()));

  /** The panel's own secret key as 64 hex characters; empty until the first publication generates one. */
  private readonly secretKeyState = signal('');

  /**
   * The identity this panel publishes under, as nostr writes it (`npub1…`); `null` before the key
   * exists. It is what a record published from here is found by, so it is shown rather than hidden.
   */
  readonly npub = computed(() => {
    const secret = this.secretKeyState();
    if (!secret) return null;
    try {
      return nip19.npubEncode(getPublicKey(hexToBytes(secret)));
    } catch {
      // A key that cannot be read is one from another version or a corrupted store; the next
      // publication replaces it (see {@link secretKey}).
      return null;
    }
  });

  /** Whether the setting stands away from what the panel ships with — see ChatStyleService.changedSettings. */
  readonly changedSettings = computed(() => (this.relayState().trim() ? 1 : 0));

  /** Load the persisted settings. Before the forwarding step can offer the relay. */
  async load(): Promise<void> {
    this.relayState.set(
      (await this.browserExtension.storageGet<string>(APP_CONFIG.storageKeys.nostrRelayUrl, '')) || ''
    );
    this.secretKeyState.set(
      (await this.browserExtension.storageGet<string>(APP_CONFIG.storageKeys.nostrSecretKey, '')) || ''
    );
  }

  /** Take over the relay the settings name. Empty puts the configured default back in force. */
  async setRelayUrl(url: string): Promise<void> {
    const trimmed = url.trim();
    this.relayState.set(trimmed);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.nostrRelayUrl, trimmed);
  }

  /** Take over whether the content is to go to the relay — see {@link selected}. */
  select(selected: boolean): void {
    this.selectedState.set(selected);
    // A refusal belongs to the attempt it came from; unticking and ticking again is a fresh attempt.
    if (!selected) this.errorState.set(null);
  }

  /**
   * Let go of what was published for one content: the tick, the receipt and the refusal all describe
   * *that* content, so the next one starts without them. The key is not touched — it is the panel's
   * identity and outlives every content published under it.
   */
  reset(): void {
    this.selectedState.set(false);
    this.sendingState.set(false);
    this.errorState.set(null);
    this.receiptState.set(null);
  }

  /**
   * Publish the content as an AMB record. Answers whether the relay kept it; a refusal and a failure are
   * both reported in {@link error} and both answer `false`, since neither leaves a record on the relay.
   *
   * Nothing happens where the step was not ticked, and nothing happens twice: a content already published
   * in this pass answers `true` without a second event, so returning to the step and walking on again does
   * not republish it.
   */
  async forward(source: AmbSource): Promise<boolean> {
    if (!this.selectedState()) return true;
    if (this.receiptState()) return true;

    this.errorState.set(null);
    const relayUrl = this.relayUrl();
    if (!isRelayUrl(relayUrl)) {
      this.errorState.set(
        `„${relayUrl}“ ist keine Relay-Adresse. Ein Nostr-Relay wird über WebSocket angesprochen, ` +
          'die Adresse beginnt also mit wss:// (oder ws:// im lokalen Netz).'
      );
      return false;
    }

    const resource = toAmbResource(source);
    if (!resource) {
      this.errorState.set(
        'Für diesen Inhalt fehlt, was AMB mindestens verlangt: eine Adresse, unter der die Ressource ' +
          'erreichbar ist, und ein Titel.'
      );
      return false;
    }

    this.sendingState.set(true);
    try {
      const secret = await this.secretKey();
      // Signing turns the template into the event: `finalizeEvent` adds the pubkey, computes the id as
      // the hash of the serialized event (NIP-01) and signs that id.
      const event = finalizeEvent(
        toAmbEvent(resource, Math.floor(Date.now() / 1000)),
        secret
      ) as SignedNostrEvent;

      console.log(`${LOG} → ${resource.name}`, {
        relay: relayUrl,
        kind: event.kind,
        d: resource.id,
        tags: event.tags.length
      });

      const ack: RelayAck = await publishToRelay(relayUrl, event);
      this.receiptState.set(this.toReceipt(relayUrl, resource, event, ack));

      if (!ack.accepted) {
        this.errorState.set(
          `Das Relay hat den Eintrag abgelehnt${ack.message ? `: ${ack.message}` : '.'}`
        );
        return false;
      }
      console.log(`${LOG} ✔ ${resource.name} auf ${relayUrl}`);
      return true;
    } catch (cause) {
      console.warn(`${LOG} ✖ ${resource.name}`, cause);
      this.errorState.set(errorMessage(cause));
      return false;
    } finally {
      this.sendingState.set(false);
    }
  }

  /** The receipt of one exchange, with the three names the event can be looked up under. */
  private toReceipt(
    relayUrl: string,
    resource: AmbResource,
    event: SignedNostrEvent,
    ack: RelayAck
  ): NostrReceipt {
    // The relay is named in both references, so whoever is handed one can fetch the event without
    // having to be told where it lives.
    const relays = [relayUrl];
    return {
      relayUrl,
      accepted: ack.accepted,
      message: ack.message,
      at: Date.now(),
      resource,
      event,
      npub: nip19.npubEncode(event.pubkey),
      nevent: nip19.neventEncode({ id: event.id, author: event.pubkey, kind: event.kind, relays }),
      naddr: nip19.naddrEncode({ identifier: resource.id, pubkey: event.pubkey, kind: AMB_KIND, relays })
    };
  }

  /**
   * The panel's own secret key, generated on first use and kept from then on. A stored value that is not
   * a readable key is replaced rather than used — it comes from another version or a damaged store, and
   * failing to publish over it would leave the user with nothing to do about it.
   */
  private async secretKey(): Promise<Uint8Array> {
    const stored = this.secretKeyState();
    if (stored) {
      try {
        const key = hexToBytes(stored);
        if (key.length === 32) return key;
      } catch {
        // Falls through to a new key.
      }
      console.warn(`${LOG} ⚠ gespeicherter Schlüssel unlesbar — es wird ein neuer erzeugt`);
    }
    const generated = generateSecretKey();
    const hex = bytesToHex(generated);
    this.secretKeyState.set(hex);
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.nostrSecretKey, hex);
    console.log(`${LOG} ✚ neuer Schlüssel erzeugt, npub ${this.npub()}`);
    return generated;
  }
}
