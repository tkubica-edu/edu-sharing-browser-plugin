import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Makes every un-mocked outbound call fail the test that made it, rather than reaching the service it
 * names. A unit test that talks to ContentJudge, MetalookUp or a repository is not a unit test, and a
 * run whose result depends on a staging deployment being up says nothing either way.
 *
 * Four channels, because that is how many ways out of the panel there are: raw `fetch`
 * (`util/json-api.ts` and the few services with a `fetch` of their own), `HttpClient` (everything going
 * through `ngx-edu-sharing-api`), `WebSocket` — which nostr uses and nothing else does, since a relay
 * has no HTTP path at all (`util/nostr-relay.ts`) — and `XMLHttpRequest`, which the panel itself never
 * builds but the two `install*` modules in `util/` patch, and which jsdom implements for real. The HTTP
 * half is diverted by `provideHttpClientTesting` in `test-providers.ts`; what is added here is the
 * *verdict* — an unanswered request is a failure instead of a request nobody looked at.
 *
 * A spec that exercises `fetch` or `WebSocket` stubs the global again in its own test or `beforeEach`,
 * which runs after this one and therefore wins (`fakeRelay()` in the nostr spec does exactly that);
 * `unstubAllGlobals` puts them all back afterwards. `XMLHttpRequest` is the one that cannot work that
 * way: it is guarded on the *prototype*, since that is where the modules under test patch it, and the
 * guard is put back per test — so a spec whose subject is such a patch re-applies it in its own
 * `beforeEach` (see `bundle-requests.spec.ts`), which runs after this one.
 */

/** Every address a blocked call named, so the report says which service was reached for. */
let blocked: string[] = [];

/** Every relay a blocked socket named — recorded apart, so the report can name the channel too. */
let dialled: string[] = [];

/** Every address a blocked XHR named, recorded apart for the same reason. */
let requested: string[] = [];

/** The prototype members the XHR guard stands in for, so each test starts from the real ones. */
const nativeXhr = {
  open: XMLHttpRequest.prototype.open,
  send: XMLHttpRequest.prototype.send,
};

/** What a guarded XHR was opened on, per instance — the address its `send` is reported under. */
const openedOn = new WeakMap<XMLHttpRequest, string>();

beforeEach(() => {
  blocked = [];
  dialled = [];
  requested = [];
  // On the prototype rather than on the constructor: `util/bundle-requests.ts` and
  // `util/bundle-language.ts` patch it there, so that is where a request has to be caught. Recorded
  // *and* thrown, as above: `installDraftRequestGuard` answers some requests itself, so a swallowed
  // throw would leave a test passing while jsdom went to the network for the rest.
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    ...args: [string, string | URL, ...unknown[]]
  ): void {
    openedOn.set(this, String(args[1] ?? ''));
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest): void {
    const url = openedOn.get(this) ?? '(never opened)';
    requested.push(url);
    throw new Error(`unmocked XMLHttpRequest in a unit test: ${url}`);
  };
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
  const sent = requested;
  blocked = [];
  dialled = [];
  requested = [];
  XMLHttpRequest.prototype.open = nativeXhr.open;
  XMLHttpRequest.prototype.send = nativeXhr.send;
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
  if (sent.length) {
    throw new Error(
      `this test sent ${sent.length} un-mocked XMLHttpRequest(s): ${sent.join(', ')} — ` +
        'replace the prototype members in the spec\'s own beforeEach (see bundle-requests.spec.ts)',
    );
  }
  // An outstanding request means a service asked for something the test did not account for.
  TestBed.inject(HttpTestingController).verify();
});
