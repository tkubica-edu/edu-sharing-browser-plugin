import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RelayAck, SignedNostrEvent, isRelayUrl, publishToRelay, queryRelay } from './nostr-relay';

/** A relay address reserved by RFC 2606, so nothing here can reach a real one. */
const RELAY = 'wss://relay.test';

/** The event a publication sends. */
function anEvent(overrides: Partial<SignedNostrEvent> = {}): SignedNostrEvent {
  return {
    id: 'e1',
    pubkey: 'p1',
    created_at: 1_764_000_000,
    kind: 30_142,
    tags: [['d', 'https://example.org/optik']],
    content: '{}',
    sig: 's1',
    ...overrides,
  };
}

/**
 * The relay, driven frame by frame: nothing happens until the test says it does, which is what lets
 * every ending of the exchange — an answer, a refusal, a silence, a close — be reached on purpose.
 */
class FakeSocket {
  static last: FakeSocket | null = null;

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;

  /** Every frame the panel sent, parsed. */
  readonly sent: unknown[] = [];
  closes = 0;

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }

  send(frame: string): void {
    this.sent.push(JSON.parse(frame));
  }

  close(): void {
    this.closes += 1;
  }

  /** The relay accepted the connection. */
  open(): this {
    this.onopen?.();
    return this;
  }

  /** The relay sent this frame. */
  deliver(frame: unknown): this {
    return this.raw(JSON.stringify(frame));
  }

  /** The relay sent exactly this, whatever it is. */
  raw(data: string): this {
    this.onmessage?.({ data });
    return this;
  }

  /** The connection failed. */
  fail(): this {
    this.onerror?.();
    return this;
  }

  /** The relay hung up. */
  shut(reason = ''): this {
    this.onclose?.({ reason });
    return this;
  }
}

/** The socket the call under test opened. */
function socket(): FakeSocket {
  return FakeSocket.last!;
}

describe('isRelayUrl', () => {
  it('accepts the only scheme a relay speaks', () => {
    expect(isRelayUrl('wss://relay.test')).toBe(true);
    expect(isRelayUrl('ws://localhost:7777')).toBe(true);
    expect(isRelayUrl('  wss://relay.test/nostr  ')).toBe(true);
  });

  it('names an https address as the configuration mistake it is, rather than dialling it', () => {
    expect(isRelayUrl('https://relay.test')).toBe(false);
    expect(isRelayUrl('relay.test')).toBe(false);
    expect(isRelayUrl('')).toBe(false);
    expect(isRelayUrl('wss://')).toBe(false);
    expect(isRelayUrl('wss:// relay.test')).toBe(false);
  });
});

describe('queryRelay', () => {
  beforeEach(() => {
    FakeSocket.last = null;
    // Stubbed over the guard from `no-network.setup.ts`, which runs first: this module's socket is
    // the subject here, so it needs a relay to talk to rather than a refusal.
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(() => vi.useRealTimers());

  it('asks the relay with the filters it was given, as one REQ', async () => {
    const pending = queryRelay(RELAY, [{ kinds: [30_142] }, { '#e': ['n1'] }]);
    socket().open();

    expect(socket().sent).toEqual([['REQ', 'es-lookup', { kinds: [30_142] }, { '#e': ['n1'] }]]);

    socket().deliver(['EOSE', 'es-lookup']);
    await pending;
  });

  it('answers with the events the relay handed back before it ended the answer', async () => {
    const pending = queryRelay(RELAY, [{}]);
    socket()
      .open()
      .deliver(['EVENT', 'es-lookup', anEvent({ id: 'a' })])
      .deliver(['EVENT', 'es-lookup', anEvent({ id: 'b' })])
      .deliver(['EOSE', 'es-lookup']);

    expect((await pending).map((event) => event.id)).toEqual(['a', 'b']);
  });

  it('answers with nothing where the relay simply holds nothing', async () => {
    const pending = queryRelay(RELAY, [{}]);
    socket().open().deliver(['EOSE', 'es-lookup']);

    await expect(pending).resolves.toEqual([]);
  });

  it('keeps what the relay handed over before refusing the question', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pending = queryRelay(RELAY, [{}]);
    socket()
      .open()
      .deliver(['EVENT', 'es-lookup', anEvent()])
      .deliver(['CLOSED', 'es-lookup', 'error: too many filters']);

    await expect(pending).resolves.toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CLOSED'), 'error: too many filters');
    warn.mockRestore();
  });

  it('reads only the frames of its own question', async () => {
    const pending = queryRelay(RELAY, [{}]);
    socket()
      .open()
      .deliver(['EVENT', 'jemand-anderes', anEvent()])
      .deliver(['EOSE', 'jemand-anderes'])
      .deliver(['EOSE', 'es-lookup']);

    await expect(pending).resolves.toEqual([]);
  });

  it('passes over anything the relay sends that is not a frame', async () => {
    const pending = queryRelay(RELAY, [{}]);
    socket().open().raw('kein JSON').raw('"auch kein Frame"').deliver(['EOSE', 'es-lookup']);

    await expect(pending).resolves.toEqual([]);
  });

  it('closes the connection with the answer — a lookup asks about the past', async () => {
    const pending = queryRelay(RELAY, [{}]);
    socket().open().deliver(['EOSE', 'es-lookup']);
    await pending;

    expect(socket().closes).toBe(1);
  });

  it('reports a relay that cannot be reached', async () => {
    const pending = queryRelay(RELAY, [{}]);
    socket().fail();

    await expect(pending).rejects.toThrow(`Das Relay ${RELAY} ist nicht erreichbar.`);
  });

  it('reports a relay that hangs up before answering', async () => {
    const pending = queryRelay(RELAY, [{}]);
    socket().open().shut();

    await expect(pending).rejects.toThrow('hat die Verbindung geschlossen, bevor es geantwortet hat');
  });

  it('gives up on a relay that stays silent, rather than holding the screen on a spinner', async () => {
    vi.useFakeTimers();
    const pending = queryRelay(RELAY, [{}]);
    const settled = expect(pending).rejects.toThrow('nicht innerhalb von 8 s geantwortet');
    socket().open();

    await vi.advanceTimersByTimeAsync(8_000);

    await settled;
  });

  it('ends the exchange once, however many endings the relay sends after it', async () => {
    vi.useFakeTimers();
    const pending = queryRelay(RELAY, [{}]);
    socket().open().deliver(['EOSE', 'es-lookup']).shut().fail();
    await pending;

    await vi.advanceTimersByTimeAsync(8_000);

    expect(socket().closes).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports an address the socket refuses to be opened on', async () => {
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          throw new Error('SecurityError');
        }
      },
    );
    await expect(queryRelay('wss://relay.test', [{}])).rejects.toThrow('nicht möglich');
  });
});

describe('publishToRelay', () => {
  beforeEach(() => {
    FakeSocket.last = null;
    vi.stubGlobal('WebSocket', FakeSocket);
  });

  afterEach(() => vi.useRealTimers());

  it('sends the event once the socket is open', async () => {
    const event = anEvent();
    const pending = publishToRelay(RELAY, event);
    socket().open();

    expect(socket().sent).toEqual([['EVENT', event]]);

    socket().deliver(['OK', 'e1', true, '']);
    await pending;
  });

  it('answers with the relay\'s verdict', async () => {
    const pending = publishToRelay(RELAY, anEvent());
    socket().open().deliver(['OK', 'e1', true, '']);

    await expect(pending).resolves.toEqual({ accepted: true, message: '' } satisfies RelayAck);
  });

  it('reads a refusal as an answer rather than a failure, with the reason the relay gave', async () => {
    const pending = publishToRelay(RELAY, anEvent());
    socket().open().deliver(['OK', 'e1', false, 'blocked: pubkey not allowed']);

    await expect(pending).resolves.toEqual({
      accepted: false,
      message: 'blocked: pubkey not allowed',
    } satisfies RelayAck);
  });

  it('counts only a literal true as acceptance, and reports a missing reason as none', async () => {
    const pending = publishToRelay(RELAY, anEvent());
    socket().open().deliver(['OK', 'e1', 'true']);

    await expect(pending).resolves.toEqual({ accepted: false, message: '' } satisfies RelayAck);
  });

  it('waits for the verdict on its own event, not on another', async () => {
    const pending = publishToRelay(RELAY, anEvent());
    socket().open().deliver(['OK', 'ein-anderes', true, '']).deliver(['OK', 'e1', true, 'gespeichert']);

    await expect(pending).resolves.toMatchObject({ message: 'gespeichert' });
  });

  it('logs a NOTICE instead of reading it as the verdict — it names no event', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pending = publishToRelay(RELAY, anEvent());
    socket().open().deliver(['NOTICE', 'rate limited']).deliver(['OK', 'e1', true, '']);

    await expect(pending).resolves.toMatchObject({ accepted: true });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NOTICE'), 'rate limited');
    warn.mockRestore();
  });

  it('passes over anything the relay sends that is not a frame', async () => {
    const pending = publishToRelay(RELAY, anEvent());
    socket().open().raw('kein JSON').deliver({ ok: true }).deliver(['OK', 'e1', true, '']);

    await expect(pending).resolves.toMatchObject({ accepted: true });
  });

  it('closes the connection with the publication', async () => {
    const pending = publishToRelay(RELAY, anEvent());
    socket().open().deliver(['OK', 'e1', true, '']);
    await pending;

    expect(socket().closes).toBe(1);
  });

  it('reports a relay that cannot be reached', async () => {
    const pending = publishToRelay(RELAY, anEvent());
    socket().fail();

    await expect(pending).rejects.toThrow(`Das Relay ${RELAY} ist nicht erreichbar.`);
  });

  it('reports a relay that hangs up, and names the reason where it gave one', async () => {
    const pending = publishToRelay(RELAY, anEvent());
    socket().open().shut('policy violation');

    await expect(pending).rejects.toThrow(
      'hat die Verbindung geschlossen, bevor es geantwortet hat (policy violation).',
    );
  });

  it('reports a relay that hangs up without a word', async () => {
    const pending = publishToRelay(RELAY, anEvent());
    socket().open().shut();

    await expect(pending).rejects.toThrow(
      'hat die Verbindung geschlossen, bevor es geantwortet hat.',
    );
  });

  it('gives up on a relay that stays silent', async () => {
    vi.useFakeTimers();
    const pending = publishToRelay(RELAY, anEvent());
    const settled = expect(pending).rejects.toThrow('nicht innerhalb von 15 s geantwortet');
    socket().open();

    await vi.advanceTimersByTimeAsync(15_000);

    await settled;
  });

  it('reports an address the socket refuses to be opened on', async () => {
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          throw new Error('SecurityError');
        }
      },
    );
    await expect(publishToRelay('wss://relay.test', anEvent())).rejects.toThrow('nicht möglich');
  });
});
