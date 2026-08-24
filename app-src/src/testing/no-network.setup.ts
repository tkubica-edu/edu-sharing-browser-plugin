import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Makes every un-mocked outbound call fail the test that made it, rather than reaching the service it
 * names. A unit test that talks to ContentJudge, MetalookUp or a repository is not a unit test, and a
 * run whose result depends on a staging deployment being up says nothing either way.
 *
 * Two halves, because the app has two outbound channels: raw `fetch` (`util/json-api.ts` and the few
 * services with a `fetch` of their own) and `HttpClient` (everything going through
 * `ngx-edu-sharing-api`). The HTTP half is diverted by `provideHttpClientTesting` in
 * `test-providers.ts`; what is added here is the *verdict* — an unanswered request is a failure
 * instead of a request nobody looked at.
 *
 * A spec that exercises a `fetch` of its own stubs the global again in its own `beforeEach`, which
 * runs after this one and therefore wins; `unstubAllGlobals` puts both back afterwards.
 */

/** Every address a blocked call named, so the report says which service was reached for. */
let blocked: string[] = [];

beforeEach(() => {
  blocked = [];
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
});

afterEach(() => {
  const reached = blocked;
  blocked = [];
  vi.unstubAllGlobals();
  if (reached.length) {
    throw new Error(
      `this test reached for ${reached.length} un-mocked fetch call(s): ${reached.join(', ')}`,
    );
  }
  // An outstanding request means a service asked for something the test did not account for.
  TestBed.inject(HttpTestingController).verify();
});
