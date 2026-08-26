import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Makes every un-mocked outbound call fail the test that made it, rather than reaching the service it
 * names. A unit test that talks to ContentJudge, MetalookUp or a repository is not a unit test, and a
 * run whose result depends on a staging deployment being up says nothing either way.
 *
 * Three channels, because that is how many ways out of the panel there are: raw `fetch`
 * (`util/json-api.ts` and the few services with a `fetch` of their own), `HttpClient` (everything going
 * through `ngx-edu-sharing-api`), and `WebSocket` — which nostr uses and nothing else does, since a relay
 * has no HTTP path at all (`util/nostr-relay.ts`). The HTTP half is diverted by `provideHttpClientTesting`
 * in `test-providers.ts`; what is added here is the *verdict* — an unanswered request is a failure instead
 * of a request nobody looked at.
 *
 * A spec that exercises one of these stubs the global again in its own test or `beforeEach`, which runs
 * after this one and therefore wins (`fakeRelay()` in the nostr spec does exactly that);
 * `unstubAllGlobals` puts them all back afterwards.
 */

/** Every address a blocked call named, so the report says which service was reached for. */
let blocked: string[] = [];

/** Every relay a blocked socket named — recorded apart, so the report can name the channel too. */
let dialled: string[] = [];

beforeEach(() => {
  blocked = [];
  dialled = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
      blocked.push(url);
      // Thrown as well as recorded, so the call site fails at once where nothing catches it. The
      // record is what makes the failure unswallowable: `fetchJson` turns any `fetch` rejection into
      // its own „<service> nicht erreichbar" error, which a test could otherwise assert on and pass.
      throw new Error(`unmocked fetch in a unit test: ${url}`);
    }),
  );
  // jsdom's own WebSocket dials for real, so an un-faked one would have a unit test talking to a live
  // relay — over the public address the panel ships with, at that. Thrown *and* recorded for the same
  // reason as above: `publishToRelay` catches the constructor's throw and turns it into a rejection of
  // its own, which a test could otherwise assert on and pass while having reached for the network.
  vi.stubGlobal(
    'WebSocket',
    class BlockedWebSocket {
      constructor(url: string) {
        dialled.push(String(url));
        throw new Error(`unmocked WebSocket in a unit test: ${url}`);
      }
    },
  );
});

afterEach(() => {
  const reached = blocked;
  const relays = dialled;
  blocked = [];
  dialled = [];
  vi.unstubAllGlobals();
  if (reached.length) {
    throw new Error(
      `this test reached for ${reached.length} un-mocked fetch call(s): ${reached.join(', ')}`,
    );
  }
  if (relays.length) {
    throw new Error(
      `this test opened ${relays.length} un-mocked WebSocket(s): ${relays.join(', ')} — ` +
        'stub the global (see fakeRelay() in nostr-forward.service.spec.ts)',
    );
  }
  // An outstanding request means a service asked for something the test did not account for.
  TestBed.inject(HttpTestingController).verify();
});
