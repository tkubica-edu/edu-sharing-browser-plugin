import { EnvironmentProviders, Provider } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

/**
 * The providers every TestBed of this workspace starts with, handed to `initTestEnvironment` by the
 * `@angular/build:unit-test` builder (`providersFile` in angular.json).
 *
 * `provideHttpClientTesting` is the floor under the rule that no unit test talks to a real service. It
 * replaces the HTTP backend for *every* test, so even a repository service that reaches DI unnoticed
 * answers from the `HttpTestingController` instead of the network — see `no-network.setup.ts`, which is
 * what turns such a request into a failure. `withInterceptorsFromDi()` is deliberately absent: the
 * library's own `ApiInterceptor` is not what any of these tests are about.
 *
 * No change detection provider belongs here. The TestBed compiles its root scope with
 * `provideZonelessChangeDetectionInternal()` already in it, so it is zoneless by itself — and because
 * the build target lists no `zone.js` polyfill, the builder adds no zone provider either. The two line
 * up; adding `provideZonelessChangeDetection()` would only duplicate a root-scope provider at module
 * scope. The same absence is why `fakeAsync()`/`tick()` do not work here: `zone.js/testing` is never
 * loaded. Use `vi.useFakeTimers()` and `TestBed.tick()` instead.
 */
const testProviders: (Provider | EnvironmentProviders)[] = [
  provideHttpClient(),
  provideHttpClientTesting(),
];

export default testProviders;
