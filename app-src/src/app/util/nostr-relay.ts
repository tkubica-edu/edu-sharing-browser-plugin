// Publishing one event to one nostr relay. Nostr has no HTTP write path: a relay is a WebSocket that
// takes `["EVENT", <event>]` and answers `["OK", <event id>, <accepted>, <reason>]` (NIP-01). That
// exchange is the whole protocol needed here, so it is done by hand rather than through a client
// library — what a publication has to report back is exactly the relay's own answer.

/** A signed event as it goes over the wire. */
export interface SignedNostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/** What the relay answered: whether it kept the event, and what it said about it. */
export interface RelayAck {
  accepted: boolean;
  /**
   * The relay's own words. On a refusal it carries the reason — `blocked:`, `invalid:` and the other
   * machine-readable prefixes of NIP-01 — and on an acceptance it is usually empty.
   */
  message: string;
}

/** How long a publication may take altogether: connecting, sending, and waiting for the answer. */
const PUBLISH_TIMEOUT_MS = 15_000;

/**
 * How long a lookup may take. Shorter than a publication, because a screen waits on it: a relay that is
 * slow to answer what it holds is answered with "not known" rather than kept on screen as a spinner.
 */
const QUERY_TIMEOUT_MS = 8_000;

/** What a lookup asks for, in the shape NIP-01 defines: `kinds`, `authors`, `#<letter>` tag filters. */
export type RelayFilter = Record<string, unknown>;

/** Log prefix, as everywhere else in the extension (`[edu-sharing][<station>]`). */
const LOG = '[edu-sharing][nostr]';

/**
 * Whether an address can be a relay's. Nostr relays speak WebSocket and nothing else, so an `https://`
 * address is a configuration mistake worth naming rather than a connection worth attempting.
 */
export function isRelayUrl(url: string): boolean {
  return /^wss?:\/\/[^\s]+$/i.test(url.trim());
}

/**
 * Ask the relay what it holds, and answer with the events it hands back. Several filters are an *or*
 * (NIP-01), so one query can ask "the record under this identifier, or one pointing at this node".
 *
 * A relay ends its answer with `EOSE` — "end of stored events" — which is what this waits for; the
 * subscription is closed with it, since a lookup asks about the past and not about what arrives next.
 * Rejects only where there was no exchange at all, and resolves with an empty list where the relay
 * simply holds nothing.
 */
export function queryRelay(relayUrl: string, filters: readonly RelayFilter[]): Promise<SignedNostrEvent[]> {
  return new Promise<SignedNostrEvent[]>((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(relayUrl);
    } catch (cause) {
      reject(new Error(`Verbindung zu ${relayUrl} nicht möglich: ${String(cause)}`));
      return;
    }

    // Names this one question, so the relay's frames can be told from those of any other.
    const subscription = 'es-lookup';
    const events: SignedNostrEvent[] = [];

    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // A socket that is already closing needs no closing.
      }
      outcome();
    };

    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error(`Das Relay ${relayUrl} hat nicht innerhalb von ${QUERY_TIMEOUT_MS / 1000} s geantwortet.`))
        ),
      QUERY_TIMEOUT_MS
    );

    socket.onopen = () => {
      console.log(`${LOG} → REQ an ${relayUrl}`, filters);
      socket.send(JSON.stringify(['REQ', subscription, ...filters]));
    };

    socket.onmessage = (message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        return;
      }
      if (!Array.isArray(frame) || frame[1] !== subscription) return;
      if (frame[0] === 'EVENT') {
        events.push(frame[2] as SignedNostrEvent);
        return;
      }
      // CLOSED ends the subscription without an EOSE — the relay refused the question (too many
      // filters, an unsupported one). What it already handed over still counts.
      if (frame[0] === 'CLOSED') {
        console.warn(`${LOG} ⚠ CLOSED von ${relayUrl}:`, frame[2]);
        finish(() => resolve(events));
        return;
      }
      if (frame[0] === 'EOSE') {
        console.log(`${LOG} ← EOSE von ${relayUrl}, ${events.length} Einträge`);
        finish(() => resolve(events));
      }
    };

    socket.onerror = () =>
      finish(() => reject(new Error(`Das Relay ${relayUrl} ist nicht erreichbar.`)));

    socket.onclose = () =>
      finish(() =>
        reject(new Error(`Das Relay ${relayUrl} hat die Verbindung geschlossen, bevor es geantwortet hat.`))
      );
  });
}

/**
 * Send the event to the relay and wait for its verdict. Resolves with what the relay answered —
 * a refusal is an answer, not a failure — and rejects only where there was no exchange at all: the
 * socket would not open, it closed before answering, or the relay stayed silent past the timeout.
 *
 * The socket is opened for this one publication and closed again with it: the panel publishes on a
 * user's decision and at no other time, so a connection held open between them would only be a
 * connection to keep alive.
 */
export function publishToRelay(relayUrl: string, event: SignedNostrEvent): Promise<RelayAck> {
  return new Promise<RelayAck>((resolve, reject) => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(relayUrl);
    } catch (cause) {
      reject(new Error(`Verbindung zu ${relayUrl} nicht möglich: ${String(cause)}`));
      return;
    }

    // Every ending goes through here, so the socket is closed and the timer cleared exactly once
    // however the exchange ends — including the endings the relay itself decides.
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // A socket that is already closing needs no closing.
      }
      outcome();
    };

    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new Error(`Das Relay ${relayUrl} hat nicht innerhalb von ${PUBLISH_TIMEOUT_MS / 1000} s geantwortet.`))
        ),
      PUBLISH_TIMEOUT_MS
    );

    socket.onopen = () => {
      console.log(`${LOG} → EVENT ${event.id} an ${relayUrl}`);
      socket.send(JSON.stringify(['EVENT', event]));
    };

    socket.onmessage = (message) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(message.data));
      } catch {
        // A relay may send anything; what is not JSON is not the answer being waited for.
        return;
      }
      if (!Array.isArray(frame)) return;
      // NOTICE is the relay talking to the operator, not answering this event — logged, not read as
      // the verdict, since it carries no event id to match against.
      if (frame[0] === 'NOTICE') {
        console.warn(`${LOG} ⚠ NOTICE von ${relayUrl}:`, frame[1]);
        return;
      }
      if (frame[0] !== 'OK' || frame[1] !== event.id) return;
      const ack: RelayAck = { accepted: frame[2] === true, message: String(frame[3] ?? '') };
      console.log(`${LOG} ← OK ${event.id} ${ack.accepted ? 'akzeptiert' : 'abgelehnt'} ${ack.message}`);
      finish(() => resolve(ack));
    };

    socket.onerror = () =>
      finish(() => reject(new Error(`Das Relay ${relayUrl} ist nicht erreichbar.`)));

    socket.onclose = (closed) =>
      finish(() =>
        reject(
          new Error(
            `Das Relay ${relayUrl} hat die Verbindung geschlossen, bevor es geantwortet hat` +
              (closed.reason ? ` (${closed.reason}).` : '.')
          )
        )
      );
  });
}
