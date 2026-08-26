import { signal } from '@angular/core';
import { vi } from 'vitest';

import { NostrForwardService, NostrReceipt } from '../../app/services/nostr-forward.service';

/**
 * `NostrForwardService` reduced to what the forwarding step's footer reads: whether the relay is ticked,
 * whether a publication is running, and whether one already happened. The publication itself is
 * {@link CurationService.forwardToNostr}'s business, so the fake carries no `forward`.
 */
export function fakeNostrForward() {
  const fake = {
    selected: signal(false),
    sending: signal(false),
    error: signal<string | null>(null),
    receipt: signal<NostrReceipt | null>(null),
    reset: vi.fn(),
  } satisfies Partial<NostrForwardService>;

  /** The step is ticked for the relay, and nothing has been published for this content yet. */
  function select(): void {
    fake.selected.set(true);
  }

  /**
   * A content that has already been published. The receipt's contents are never read by the footer —
   * only its presence is — so it stands in as the empty object it is allowed to be here.
   */
  function published(): void {
    fake.selected.set(true);
    fake.receipt.set({} as NostrReceipt);
  }

  return { fake, select, published };
}

export type NostrForwardFake = ReturnType<typeof fakeNostrForward>;
