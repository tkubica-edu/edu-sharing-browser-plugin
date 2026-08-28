import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyEvent } from 'nostr-tools/pure';

import { NostrForwardService } from './nostr-forward.service';
import { BrowserExtensionService } from './browser-extension.service';
import { APP_CONFIG } from '../config';
import { AmbSource } from '../util/amb-event';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';
import { provideFake } from '../../testing/provide-fake';

/**
 * A relay in place of the network: it takes the frames the service sends, and answers the `EVENT` with
 * whatever verdict the test asked for. Constructed by the service through the global, as the real
 * `WebSocket` is — `no-network.setup.ts` puts every stubbed global back after the test.
 */
function fakeRelay(
  options: {
    accept?: boolean;
    message?: string;
    unreachable?: boolean;
    /** What a `REQ` is answered with, before the `EOSE` that ends it. */
    holds?: readonly Record<string, unknown>[];
  } = {},
) {
  const sent: unknown[] = [];
  const asked: unknown[] = [];
  let opened: FakeSocket | null = null;

  class FakeSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: ((event: { reason: string }) => void) | null = null;
    closed = false;

    constructor(readonly url: string) {
      opened = this;
      // The socket settles on the next turn, as a real one does: the service registers its handlers
      // after the constructor returns.
      queueMicrotask(() => (options.unreachable ? this.onerror?.() : this.onopen?.()));
    }

    send(frame: string): void {
      const parsed = JSON.parse(frame) as [string, ...unknown[]];
      // A lookup asks with REQ and is answered with the stored events and then EOSE; a publication
      // sends EVENT and is answered with OK.
      if (parsed[0] === 'REQ') {
        const [, subscription, ...filters] = parsed as [string, string, ...unknown[]];
        asked.push(filters);
        queueMicrotask(() => {
          for (const event of options.holds ?? []) {
            this.onmessage?.({ data: JSON.stringify(['EVENT', subscription, event]) });
          }
          this.onmessage?.({ data: JSON.stringify(['EOSE', subscription]) });
        });
        return;
      }
      sent.push(parsed);
      const verdict = options.accept ?? true;
      const event = parsed[1] as { id: string };
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify(['OK', event.id, verdict, options.message ?? '']),
        }),
      );
    }

    close(): void {
      this.closed = true;
    }
  }

  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
  return {
    /** The frames the service sent, in order — `['EVENT', <event>]` for a publication. */
    sent,
    /** The event of the one publication that was made. */
    event: () => (sent[0] as [string, Record<string, unknown>])[1],
    /** The filters of each `REQ` the service sent, in order. */
    asked,
    /** Where the socket was opened, so a test can assert the relay that was actually reached. */
    url: () => opened?.url ?? null,
    closed: () => opened?.closed ?? false,
  };
}

/** A kind-30142 event as a relay hands one back, under whichever key the test names. */
function aStoredRecord(overrides: { pubkey?: string; identifier?: string; created_at?: number } = {}) {
  return {
    id: 'a'.repeat(64),
    pubkey: overrides.pubkey ?? 'b'.repeat(64),
    created_at: overrides.created_at ?? 1_750_000_000,
    kind: 30142,
    tags: [
      ['d', overrides.identifier ?? 'https://example.org/optik'],
      ['type', 'LearningResource'],
      ['name', 'Optik'],
    ],
    content: '',
    sig: 'c'.repeat(128),
  };
}

/**
 * The relay every test in here points at. Deliberately not the address the panel ships with: a spec that
 * names a live host is misleading in its own output, whatever the socket underneath it is — and the
 * `.test` TLD is reserved for exactly this (RFC 2606), so it can never resolve to anything.
 */
const TEST_RELAY = 'wss://relay.test';

/** A content that carries what AMB requires and a little more. */
function aSource(overrides: Partial<AmbSource> = {}): AmbSource {
  return {
    metadata: {
      'cclom:title': ['Optik'],
      'cclom:general_description': ['Eine Einführung.'],
      'ccm:wwwurl': ['https://example.org/optik'],
    },
    url: 'https://example.org/optik',
    title: 'Optik',
    imageUrl: null,
    nodeLink: null,
    repositoryUrl: null,
    ...overrides,
  };
}

describe('NostrForwardService', () => {
  let nostr: NostrForwardService;
  let extension: BrowserExtensionFake;
  /**
   * What the service wrote to `console.warn` while the test ran. Three of the tests below are about a path
   * the panel *reports in the log* — a relay it could not reach, a stored key it could not read — so that
   * line is part of the behaviour and is asserted here rather than left to the run's report, where a stack
   * trace under a passing suite reads as something having gone wrong.
   *
   * Taken over per spec and by name: `quiet-logs.setup.ts` silences `console.log` for every test and
   * deliberately leaves `warn` alone, because a warning nobody asked for should still be seen.
   */
  let warnings: string[];

  /** Whether the test looked at what was warned — see the `afterEach` below. */
  let inspected: boolean;

  /** Everything warned so far, as one string — what the assertions below look into. */
  const warned = () => {
    inspected = true;
    return warnings.join('\n');
  };

  beforeEach(async () => {
    warnings = [];
    inspected = false;
    vi.spyOn(console, 'warn').mockImplementation((...parts: unknown[]) => {
      warnings.push(parts.map((part) => String(part)).join(' '));
    });
    extension = fakeBrowserExtension();
    TestBed.configureTestingModule({
      providers: [provideFake(BrowserExtensionService, extension.fake)],
    });
    nostr = TestBed.inject(NostrForwardService);
    await nostr.load();
    // Every test that sends or looks up does so against the fake address; the two that are about the
    // configured default put the setting back themselves.
    await nostr.setRelayUrl(TEST_RELAY);
  });


  afterEach(() => {
    vi.mocked(console.warn).mockRestore();
    // A warning the test never looked at is one nobody asked for, so it goes to the report after all:
    // the point of taking `warn` over here is to assert the expected lines, not to make this spec a
    // place where a new one can appear unnoticed.
    if (!inspected) for (const line of warnings) console.warn(line);
  });

  describe('which relay it publishes to', () => {
    it('is the one the panel ships with while the settings name none', async () => {
      await nostr.setRelayUrl('');

      expect(nostr.relayUrl()).toBe(APP_CONFIG.nostrRelayUrl);
      expect(nostr.relayUsable()).toBe(true);
    });

    it('is the one the settings name, and it is remembered', async () => {
      await nostr.setRelayUrl('  wss://another.test  ');

      expect(nostr.relayUrl()).toBe('wss://another.test');
      expect(extension.storage.get(APP_CONFIG.storageKeys.nostrRelayUrl)).toBe('wss://another.test');
    });

    it('falls back to the panel`s own relay once the setting is emptied again', async () => {
      await nostr.setRelayUrl('wss://another.test');
      await nostr.setRelayUrl('');

      expect(nostr.relayUrl()).toBe(APP_CONFIG.nostrRelayUrl);
    });

    it('reports an address that cannot be a relay`s, since nostr speaks WebSocket alone', async () => {
      await nostr.setRelayUrl('https://relay.test');

      expect(nostr.relayUsable()).toBe(false);
    });
  });

  describe('publishing', () => {
    it('does nothing at all where the step was not ticked', async () => {
      const relay = fakeRelay();

      await expect(nostr.forward(aSource())).resolves.toBe(true);

      expect(relay.sent).toHaveLength(0);
      expect(nostr.receipt()).toBeNull();
    });

    it('sends a signed AMB event to the configured relay and closes the socket after it', async () => {
      const relay = fakeRelay();
      await nostr.setRelayUrl('wss://another.test');
      nostr.select(true);

      await expect(nostr.forward(aSource())).resolves.toBe(true);

      expect(relay.url()).toBe('wss://another.test');
      const [verb, event] = relay.sent[0] as [string, Record<string, unknown>];
      expect(verb).toBe('EVENT');
      expect(event['kind']).toBe(30142);
      // The signature is what a relay checks first; a client that gets it wrong is refused outright.
      expect(verifyEvent(event as never)).toBe(true);
      expect(relay.closed()).toBe(true);
    });

    it('keeps the whole exchange as the receipt, under the names it can be looked up by', async () => {
      fakeRelay({ message: '' });
      nostr.select(true);

      await nostr.forward(aSource());

      const receipt = nostr.receipt();
      expect(receipt?.accepted).toBe(true);
      expect(receipt?.resource.id).toBe('https://example.org/optik');
      expect(receipt?.npub).toMatch(/^npub1/);
      expect(receipt?.nevent).toMatch(/^nevent1/);
      // The record's standing address, which keeps pointing at the current version of it.
      expect(receipt?.naddr).toMatch(/^naddr1/);
      expect(nostr.error()).toBeNull();
    });

    it('reports the relay`s refusal in its own words, and keeps it as a receipt all the same', async () => {
      fakeRelay({ accept: false, message: 'invalid: missing required "name" tag' });
      nostr.select(true);

      await expect(nostr.forward(aSource())).resolves.toBe(false);

      expect(nostr.error()).toContain('invalid: missing required "name" tag');
      expect(nostr.receipt()?.accepted).toBe(false);
    });

    it('sends nothing where the content lacks what AMB identifies a resource by', async () => {
      const relay = fakeRelay();
      nostr.select(true);

      await expect(
        nostr.forward(aSource({ metadata: { 'cclom:title': ['Optik'] }, url: null, nodeLink: null })),
      ).resolves.toBe(false);

      expect(relay.sent).toHaveLength(0);
      expect(nostr.error()).toContain('Adresse');
    });

    it('sends nothing to an address that cannot be a relay`s', async () => {
      const relay = fakeRelay();
      await nostr.setRelayUrl('https://relay.test');
      nostr.select(true);

      await expect(nostr.forward(aSource())).resolves.toBe(false);

      expect(relay.sent).toHaveLength(0);
      expect(nostr.error()).toContain('wss://');
    });

    it('publishes one content once, however often the step is walked through', async () => {
      const relay = fakeRelay();
      nostr.select(true);

      await nostr.forward(aSource());
      await expect(nostr.forward(aSource())).resolves.toBe(true);

      expect(relay.sent).toHaveLength(1);
    });
  });

  describe('publishing on its own, as the An Nostr Relay senden step does', () => {
    it('sends without the forwarding step having ticked anything', async () => {
      const relay = fakeRelay();

      await expect(nostr.publish(aSource())).resolves.toBe(true);

      expect(relay.sent).toHaveLength(1);
    });

    it('sends a published content again, so its record on the relay is replaced', async () => {
      const relay = fakeRelay();

      await nostr.publish(aSource());
      await expect(nostr.publish(aSource())).resolves.toBe(true);

      expect(relay.sent).toHaveLength(2);
      // The same identifier, which is what makes the second event replace the first (NIP-01).
      const identifierOf = (frame: unknown) =>
        ((frame as [string, { tags: string[][] }])[1].tags.find((tag) => tag[0] === 'd') ?? [])[1];
      expect(identifierOf(relay.sent[1])).toBe(identifierOf(relay.sent[0]));
    });

    it('leaves the receipt of what is on the relay standing where a re-send fails', async () => {
      fakeRelay();
      await nostr.publish(aSource());
      const published = nostr.receipt();

      // The socket does not open at all: nothing reached the relay, so what it holds is unchanged.
      fakeRelay({ unreachable: true });
      await expect(nostr.publish(aSource())).resolves.toBe(false);

      expect(nostr.receipt()).toBe(published);
      expect(nostr.error()).not.toBeNull();
      // And the panel says so in the log, which is where a failed publication is traced from.
      expect(warned()).toContain(`Das Relay ${TEST_RELAY} ist nicht erreichbar`);
    });
  });

  describe('looking the content up on the relay', () => {
    it('asks by the record`s identifier and by the node it was read off', async () => {
      const relay = fakeRelay();

      await nostr.lookup(aSource({ nodeLink: 'https://repo.example/components/render/node-1' }));

      // Two filters, which a relay reads as an "or" — the second still finds the record after the
      // content's own address has changed.
      expect(relay.asked[0]).toEqual([
        { kinds: [30142], '#d': ['https://example.org/optik'] },
        { kinds: [30142], '#r': ['https://repo.example/components/render/node-1'] },
      ]);
    });

    it('takes a record the relay holds over, marked as read off the relay rather than sent', async () => {
      fakeRelay({ holds: [aStoredRecord()] });

      await nostr.lookup(aSource());

      const receipt = nostr.receipt();
      expect(receipt?.origin).toBe('relay');
      expect(receipt?.accepted).toBe(true);
      expect(receipt?.resource.id).toBe('https://example.org/optik');
      // The moment the event states, not the moment it was found.
      expect(receipt?.at).toBe(1_750_000_000_000);
    });

    it('marks a record under a foreign key as not this installation`s', async () => {
      fakeRelay({ holds: [aStoredRecord()] });

      await nostr.lookup(aSource());

      expect(nostr.receipt()?.own).toBe(false);
    });

    it('prefers this installation`s own record over a foreign one for the same resource', async () => {
      // A key has to exist before one of its records can be recognised, and publishing is what makes one.
      fakeRelay();
      await nostr.publish(aSource());
      const own = nostr.npub();
      const pubkey = nostr.receipt()!.event.pubkey;
      nostr.reset();

      fakeRelay({
        holds: [aStoredRecord({ created_at: 1_760_000_000 }), aStoredRecord({ pubkey })],
      });
      await nostr.lookup(aSource());

      expect(nostr.receipt()?.own).toBe(true);
      expect(nostr.npub()).toBe(own);
    });

    it('reports nothing where the relay holds nothing, so the content reads as unpublished', async () => {
      fakeRelay({ holds: [] });

      await nostr.lookup(aSource());

      expect(nostr.receipt()).toBeNull();
      expect(nostr.lookupError()).toBeNull();
    });

    it('asks once per content, not once per screen that shows it', async () => {
      const relay = fakeRelay();

      await nostr.lookup(aSource());
      await nostr.lookup(aSource());

      expect(relay.asked).toHaveLength(1);
    });

    it('never asks over what this session published, which is the more exact answer', async () => {
      const relay = fakeRelay();
      await nostr.publish(aSource());

      await nostr.lookup(aSource());

      expect(relay.asked).toHaveLength(0);
      expect(nostr.receipt()?.origin).toBe('session');
    });

    it('says nothing is known where the relay could not be asked, rather than nothing is there', async () => {
      fakeRelay({ unreachable: true });

      await nostr.lookup(aSource());

      expect(nostr.receipt()).toBeNull();
      expect(nostr.lookupError()).not.toBeNull();
      expect(warned()).toContain(`Nachsehen bei ${TEST_RELAY} fehlgeschlagen`);
      // And the question stays open: the next screen asks again rather than repeating the non-answer.
      const relay = fakeRelay({ holds: [aStoredRecord()] });
      await nostr.lookup(aSource());
      expect(relay.asked).toHaveLength(1);
      expect(nostr.receipt()?.origin).toBe('relay');
    });

    it('asks about the next content on its own account', async () => {
      const relay = fakeRelay();
      await nostr.lookup(aSource());

      nostr.reset();
      await nostr.lookup(aSource());

      expect(relay.asked).toHaveLength(2);
    });
  });

  describe('the key it publishes under', () => {
    it('is generated on the first publication and kept from then on', async () => {
      fakeRelay();
      nostr.select(true);

      await nostr.forward(aSource());
      const generated = extension.storage.get(APP_CONFIG.storageKeys.nostrSecretKey);

      expect(generated).toMatch(/^[0-9a-f]{64}$/);
      expect(nostr.npub()).toMatch(/^npub1/);

      // A second content goes out under the same identity — that is what makes the records findable
      // as one publisher's.
      nostr.reset();
      nostr.select(true);
      await nostr.forward(aSource());

      expect(extension.storage.get(APP_CONFIG.storageKeys.nostrSecretKey)).toBe(generated);
    });

    it('replaces a stored key that cannot be read, rather than failing to publish over it', async () => {
      extension.storage.set(APP_CONFIG.storageKeys.nostrSecretKey, 'not-a-key');
      await nostr.load();
      fakeRelay();
      nostr.select(true);

      await expect(nostr.forward(aSource())).resolves.toBe(true);

      expect(extension.storage.get(APP_CONFIG.storageKeys.nostrSecretKey)).toMatch(/^[0-9a-f]{64}$/);
      // Said out loud rather than done silently: the key that went is the identity every record this
      // installation published was signed with, and nothing brings it back.
      expect(warned()).toContain('gespeicherter Schlüssel unlesbar');
    });
  });

  describe('the switch that takes the relay out of the panel altogether', () => {
    it('is on to begin with, the relay being every repository`s', () => {
      expect(nostr.enabled()).toBe(true);
    });

    it('is remembered, so a panel that was switched off comes back switched off', async () => {
      await nostr.setEnabled(false);

      await nostr.load();

      expect(nostr.enabled()).toBe(false);
    });

    it('sends nothing while it is off, whatever the step ticked', async () => {
      const relay = fakeRelay();
      nostr.select(true);
      await nostr.setEnabled(false);

      // The forwarding leads on rather than reporting a failure: there is nothing to publish, which is
      // not the same as a publication that did not get through.
      expect(await nostr.forward(aSource())).toBe(true);
      expect(await nostr.publish(aSource())).toBe(false);
      expect(relay.sent).toEqual([]);
      expect(nostr.receipt()).toBeNull();
    });

    it('asks no relay what it holds while it is off', async () => {
      const relay = fakeRelay({ holds: [aStoredRecord()] });
      await nostr.setEnabled(false);

      await nostr.lookup(aSource());

      expect(relay.asked).toEqual([]);
      expect(nostr.receipt()).toBeNull();
    });

    it('lets go of what the content had with the relay as it goes off', async () => {
      fakeRelay();
      nostr.select(true);
      await nostr.forward(aSource());

      await nostr.setEnabled(false);

      // Nothing of it is shown any more, so nothing of it may come back with the switch either.
      expect(nostr.selected()).toBe(false);
      expect(nostr.receipt()).toBeNull();
    });

    it('publishes again once it is back on', async () => {
      const relay = fakeRelay();
      await nostr.setEnabled(false);
      await nostr.setEnabled(true);

      expect(await nostr.publish(aSource())).toBe(true);
      expect(relay.sent).toHaveLength(1);
    });
  });

  it('lets go of what was published for one content, keeping the identity it went out under', async () => {
    fakeRelay();
    nostr.select(true);
    await nostr.forward(aSource());
    const npub = nostr.npub();

    nostr.reset();

    expect(nostr.selected()).toBe(false);
    expect(nostr.receipt()).toBeNull();
    expect(nostr.error()).toBeNull();
    expect(nostr.npub()).toBe(npub);
  });
});
