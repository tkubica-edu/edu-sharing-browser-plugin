import { Injectable, computed, inject, signal } from '@angular/core';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';

import { APP_CONFIG } from '../config';
import { AmbResource, AmbSource, AMB_KIND, toAmbEvent, toAmbResource } from '../util/amb-event';
import { errorMessage } from '../util/errors';
import {
  RelayAck, RelayFilter, SignedNostrEvent, isRelayUrl, publishToRelay, queryRelay
} from '../util/nostr-relay';
import { BrowserExtensionService } from './browser-extension.service';

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][nostr]';

/**
 * The relay is spoken to unless the settings say otherwise: publishing an AMB record needs nothing of the
 * repository and works against every one of them, so it is offered wherever the panel runs. The switch is
 * for the installation that wants nothing to do with the open network — see
 * {@link NostrForwardService.enabled}.
 */
const DEFAULT_ENABLED = true;

/**
 * What one publication left behind: the event as it went over the wire, the relay's verdict on it, and
 * the names under which it can be looked up again. Kept whole rather than summarised — the point of the
 * receipt is that the user can check what was published, and a summary is exactly what cannot be checked.
 */
export interface NostrReceipt {
  /**
   * How this panel knows about the record: `session` for one this panel published and got an `OK` for,
   * `relay` for one the relay handed back when the content was looked up there. The second is the usual
   * case after a reload — nothing about a publication is kept in this browser, the relay is asked instead
   * (see {@link NostrForwardService.lookup}).
   */
  origin: 'session' | 'relay';
  /**
   * The record was published under *this* installation's key. Only such a record is replaced by publishing
   * again: an addressable event is addressed by kind, **publisher** and identifier, so a foreign record for
   * the same resource is a second record and not an older version of this one.
   */
  own: boolean;
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

  private readonly enabledState = signal(DEFAULT_ENABLED);

  /**
   * Whether this panel speaks to a relay at all. A setting rather than a condition of the content: off, the
   * two steps that publish are not offered, the forwarding shows no relay row and the Interaktionen no
   * standing, and neither {@link publish} nor {@link lookup} reaches a relay — so an installation that has
   * switched it off sends nothing into the open network and asks nothing of it either.
   */
  readonly enabled = this.enabledState.asReadonly();

  /**
   * Whether the step is to publish to the relay. Ticked in the forwarding step and read by its way on;
   * a statement about one content, so it goes when that content does (see {@link reset}).
   */
  private readonly selectedState = signal(false);
  readonly selected = this.selectedState.asReadonly();

  /** Set while the publication runs — the row is locked by it, like the groups are by the save. */
  private readonly sendingState = signal(false);
  readonly sending = this.sendingState.asReadonly();

  /** Set while the relay is being asked what it holds about the content — see {@link lookup}. */
  private readonly lookingState = signal(false);
  readonly looking = this.lookingState.asReadonly();

  /**
   * Why the relay could not be asked; `null` while nothing failed. Kept apart from {@link error}: a lookup
   * that did not get through means *nothing is known*, which must not be shown as "not published".
   */
  private readonly lookupErrorState = signal<string | null>(null);
  readonly lookupError = this.lookupErrorState.asReadonly();

  /**
   * The record identifier the relay was last asked about. What makes the lookup happen once per content
   * rather than on every render — and happen again for the next content, whose identifier differs.
   */
  private lookedUp: string | null = null;

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

  /** The public half of that key as the wire carries it, or `null` before the key exists. */
  private readonly pubkey = computed(() => {
    const secret = this.secretKeyState();
    if (!secret) return null;
    try {
      return getPublicKey(hexToBytes(secret));
    } catch {
      return null;
    }
  });

  /**
   * The identity this panel publishes under, as nostr writes it (`npub1…`); `null` before the key
   * exists. It is what a record published from here is found by, so it is shown rather than hidden.
   */
  readonly npub = computed(() => {
    // A key that cannot be read is one from another version or a corrupted store; the next publication
    // replaces it (see {@link secretKey}), and until then this panel has no identity to name.
    const pubkey = this.pubkey();
    return pubkey ? nip19.npubEncode(pubkey) : null;
  });

  /**
   * How many of the settings stand away from what the panel ships with — see
   * ChatStyleService.changedSettings. The relay counts as changed while one is named, the default being
   * the address the panel carries itself.
   */
  readonly changedSettings = computed(
    () => (this.enabledState() === DEFAULT_ENABLED ? 0 : 1) + (this.relayState().trim() ? 1 : 0)
  );

  /** Load the persisted settings. Before the forwarding step can offer the relay. */
  async load(): Promise<void> {
    this.enabledState.set(
      await this.browserExtension.storageGet(APP_CONFIG.storageKeys.nostrEnabled, DEFAULT_ENABLED)
    );
    this.relayState.set(
      (await this.browserExtension.storageGet<string>(APP_CONFIG.storageKeys.nostrRelayUrl, '')) || ''
    );
    this.secretKeyState.set(
      (await this.browserExtension.storageGet<string>(APP_CONFIG.storageKeys.nostrSecretKey, '')) || ''
    );
  }

  /**
   * Take over whether the panel speaks to a relay at all. Switching it off also lets go of what the
   * current content had with the relay: the tick and the receipt are shown nowhere any more, and a panel
   * switched on again must not carry them back into a step as though they had just been made.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabledState.set(enabled);
    if (!enabled) this.reset();
    await this.browserExtension.storageSet(APP_CONFIG.storageKeys.nostrEnabled, enabled);
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
    this.lookupErrorState.set(null);
    // The next content is asked about on its own account; this one's answer said nothing about it.
    this.lookedUp = null;
  }

  /**
   * Ask the relay what it holds about this content, and take its answer over as the receipt. This is how
   * a publication survives a reload: nothing about it is kept in this browser — the relay is the record,
   * and asking it also catches what happened elsewhere (a publication from another installation, one that
   * has since been replaced, one the panel's own history would have claimed wrongly).
   *
   * Two questions in one, since a relay reads several filters as an *or*: the record under the identifier
   * this content would be published as, and any record pointing back at the node it was read off (the `r`
   * tag). The second is what still finds the record after the content's address changed.
   *
   * Asked once per content. Never overwrites what this session published — that receipt carries the
   * relay's own `OK` and is the more exact answer of the two.
   */
  async lookup(source: AmbSource): Promise<void> {
    if (!this.enabledState()) return;
    const resource = toAmbResource(source);
    if (!resource) return;
    if (this.lookedUp === resource.id) return;
    if (this.receiptState()?.origin === 'session') return;

    const relayUrl = this.relayUrl();
    if (!isRelayUrl(relayUrl)) return;

    this.lookedUp = resource.id;
    this.lookupErrorState.set(null);
    this.lookingState.set(true);
    try {
      const filters: RelayFilter[] = [{ kinds: [AMB_KIND], '#d': [resource.id] }];
      if (source.nodeLink) filters.push({ kinds: [AMB_KIND], '#r': [source.nodeLink] });

      const events = await queryRelay(relayUrl, filters);
      // This panel's own record first, whatever else the relay holds for the resource: it is the one a
      // further publication would replace, and so the one the screens have to speak about. Beyond that
      // the newest, which for an addressable kind is the one that stands.
      const pubkey = this.pubkey();
      const found = [...events].sort(
        (a, b) =>
          Number(b.pubkey === pubkey) - Number(a.pubkey === pubkey) || b.created_at - a.created_at
      )[0];
      if (!found) {
        console.log(`${LOG} ∅ ${relayUrl} hält nichts zu ${resource.id}`);
        return;
      }
      console.log(`${LOG} ← ${found.id} von ${relayUrl}`, { own: found.pubkey === pubkey });
      this.receiptState.set(this.toReceipt(relayUrl, this.recordOf(found), found, { accepted: true, message: '' }, 'relay'));
    } catch (cause) {
      // Nothing is known rather than nothing is there — the screens say so instead of reporting the
      // content as unpublished (see NostrStandingComponent).
      console.warn(`${LOG} ✖ Nachsehen bei ${relayUrl} fehlgeschlagen`, cause);
      this.lookupErrorState.set(errorMessage(cause));
      this.lookedUp = null;
    } finally {
      this.lookingState.set(false);
    }
  }

  /**
   * The record an event states, as far as the receipt needs it: what it is identified by and what it is
   * called. Read back off the tags rather than reconstructed in full — the whole record is listed from the
   * tags themselves where the receipt shows it, so anything derived here would only be able to disagree.
   */
  private recordOf(event: SignedNostrEvent): AmbResource {
    const value = (key: string) => event.tags.find((tag) => tag[0] === key)?.[1] ?? '';
    return {
      id: value('d'),
      name: value('name'),
      type: event.tags.filter((tag) => tag[0] === 'type').map((tag) => tag[1])
    };
  }

  /**
   * Publish the content where the forwarding step ticked the relay. Nothing happens where it did not, and
   * nothing happens twice: a content already published in this pass answers `true` without a second event,
   * so returning to the step and walking on again does not republish it. Answers whether there is a record
   * on the relay — `true` also where the step was not ticked at all, which is nothing failing.
   */
  forward(source: AmbSource): Promise<boolean> {
    // A relay that is switched off is not a publication that failed: the way on out of the step leads on
    // as it does for a step that was never ticked.
    if (!this.enabledState()) return Promise.resolve(true);
    if (!this.selectedState()) return Promise.resolve(true);
    if (this.receiptState()) return Promise.resolve(true);
    return this.publish(source);
  }

  /**
   * Publish the content as an AMB record, now and whatever went before. Answers whether the relay kept it;
   * a refusal and a failure are both reported in {@link error} and both answer `false`, since neither
   * leaves a record on the relay.
   *
   * Called again for a content that already has a receipt this replaces it, which is the point of the
   * *An Nostr Relay senden* step: a kind-30142 event is addressable, so a second publication of the same
   * resource replaces the record on the relay rather than adding a second one beside it.
   */
  async publish(source: AmbSource): Promise<boolean> {
    // Nothing leaves the panel where the relay is switched off. The screens that would ask for a
    // publication are not offered then, so this is the guard behind them rather than a case they run
    // into — and it is the one that has to hold, since a publication cannot be taken back.
    if (!this.enabledState()) return false;
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
      this.receiptState.set(this.toReceipt(relayUrl, resource, event, ack, 'session'));
      // What this panel just published is what the relay holds; nothing is gained by asking it again.
      this.lookedUp = resource.id;

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
    ack: RelayAck,
    origin: NostrReceipt['origin']
  ): NostrReceipt {
    // The relay is named in both references, so whoever is handed one can fetch the event without
    // having to be told where it lives.
    const relays = [relayUrl];
    return {
      origin,
      own: event.pubkey === this.pubkey(),
      relayUrl,
      accepted: ack.accepted,
      message: ack.message,
      // What the panel did, for its own publication; what the event states, for one read off the relay —
      // whose `created_at` is when it was published and not when it was found.
      at: origin === 'session' ? Date.now() : event.created_at * 1000,
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
