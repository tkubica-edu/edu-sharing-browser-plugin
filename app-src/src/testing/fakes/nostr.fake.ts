import { signal } from '@angular/core';
import { vi } from 'vitest';

import { NostrForwardService, NostrReceipt } from '../../app/services/nostr-forward.service';

/** The relay the panel speaks to unless a spec says otherwise. */
export const FAKE_RELAY_URL = 'wss://relay.test';

/**
 * A receipt as a publication leaves one: the record, the signed event and the three references it can be
 * fetched back by. Everything a spec does not state is the ordinary case — this installation's own key,
 * accepted, published in this session.
 */
export function aReceipt(overrides: Partial<NostrReceipt> = {}): NostrReceipt {
  return {
    origin: 'session',
    own: true,
    relayUrl: FAKE_RELAY_URL,
    accepted: true,
    message: '',
    at: Date.UTC(2026, 4, 6, 9, 30),
    resource: { id: 'https://example.org/optik', name: 'Optik' },
    event: {
      id: 'e1',
      pubkey: 'pk1',
      kind: 30142,
      created_at: 1_777_000_000,
      tags: [
        ['d', 'https://example.org/optik'],
        ['name', 'Optik'],
        ['t', 'Physik'],
      ],
      content: '',
      sig: 'sig',
    },
    npub: 'npub1beispiel',
    nevent: 'nevent1beispiel',
    naddr: 'naddr1beispiel',
    ...overrides,
  } as NostrReceipt;
}

/**
 * `NostrForwardService` reduced to what the footer and the registry read: whether the panel speaks to a
 * relay at all, whether the relay is ticked, whether the address can be one, whether a publication is
 * running, and whether one already happened. The publication itself is {@link CurationService}'s business,
 * so the fake carries neither `forward` nor `publish`.
 */
export function fakeNostrForward() {
  const fake = {
    enabled: signal(true),
    relayUrl: signal(FAKE_RELAY_URL),
    // Typed as the library types it — a key is `npub1…` or nothing at all.
    npub: signal<`npub1${string}` | null>('npub1beispiel'),
    selected: signal(false),
    sending: signal(false),
    looking: signal(false),
    relayUsable: signal(true),
    error: signal<string | null>(null),
    lookupError: signal<string | null>(null),
    receipt: signal<NostrReceipt | null>(null),
    reset: vi.fn(),
  } satisfies Partial<NostrForwardService>;

  /** The step is ticked for the relay, and nothing has been published for this content yet. */
  function select(): void {
    fake.selected.set(true);
  }

  /**
   * A content already published under this installation's own key — the one case in which sending again
   * replaces the record. Only `own` is read by the footer, so the rest of the receipt stands in as the
   * empty object it is allowed to be here.
   */
  function published(): void {
    fake.selected.set(true);
    fake.receipt.set({ own: true } as NostrReceipt);
  }

  /** A record for the same resource on the relay, but under somebody else's key. */
  function publishedByAnother(): void {
    fake.receipt.set({ own: false } as NostrReceipt);
  }

  /** The relay holds this record, whichever way the panel came to know about it. */
  function holds(receipt: Partial<NostrReceipt> = {}): void {
    fake.receipt.set(aReceipt(receipt));
  }

  /** The settings switched the relay off, so nothing about nostr is offered — see the registry. */
  function disable(): void {
    fake.enabled.set(false);
  }

  return { fake, select, published, publishedByAnother, holds, disable };
}

export type NostrForwardFake = ReturnType<typeof fakeNostrForward>;
