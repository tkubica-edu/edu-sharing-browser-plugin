import { computed, signal } from '@angular/core';
import { vi } from 'vitest';

import { OAuthDiscovery, RedirectUriInUse } from '../../app/services/browser-extension.service';
import { OAuthAvailability, OAuthProvider, OAuthService } from '../../app/services/oauth.service';

/** Where a repository publishes what it says about its own authorization server. */
const DISCOVERY_PATH = '/.well-known/oauth-authorization-server';

/**
 * What a repository that federates answers about its authorization server. Everything a spec does not
 * state is the ordinary case: a server that can be logged out of and that lists no scopes of its own,
 * which is what leaves `unsupportedScopes` empty.
 */
export function aDiscovery(overrides: Partial<OAuthDiscovery> = {}): OAuthDiscovery {
  return {
    discoveryUrl: `https://repo.example/edu-sharing${DISCOVERY_PATH}`,
    issuer: 'https://repo.example/edu-sharing',
    revocable: true,
    sessionEndable: true,
    scopesSupported: null,
    unsupportedScopes: [],
    ...overrides,
  };
}

/**
 * `OAuthService` as the login card and the settings read it: what the repository answered about its
 * authorization server, whether it is being asked right now, and the redirect address this browser will
 * use. Unasked by default — the state in which the panel behaves as if there were no SSO at all.
 *
 * `available` is derived from the answer rather than set beside it, as in the real service: the two saying
 * different things is a state no repository can put the panel in.
 */
export function fakeOAuth() {
  const availability = signal<OAuthAvailability>({ kind: 'unknown' });
  let redirectUri: RedirectUriInUse | null = null;

  const fake = {
    availability,
    available: computed(() => availability().kind === 'available'),
    probing: signal(false),
    providers: signal<readonly OAuthProvider[]>([]),
    running: signal(false),
    discoveryUrlOf: vi.fn((repositoryUrl: string): string =>
      repositoryUrl ? `${repositoryUrl.replace(/\/+$/, '')}${DISCOVERY_PATH}` : '',
    ),
    probe: vi.fn((_repositoryUrl: string): Promise<OAuthAvailability> =>
      Promise.resolve(availability()),
    ),
    redirectUriInUse: vi.fn(
      (_repositoryUrl: string): Promise<RedirectUriInUse | null> => Promise.resolve(redirectUri),
    ),
  } satisfies Partial<OAuthService>;

  /** The repository publishes an authorization server, so the SSO login is a way in. */
  function federates(server: OAuthDiscovery = aDiscovery()): void {
    availability.set({ kind: 'available', server });
  }

  /** It publishes none, which is the ordinary case and no error. */
  function federatesNothing(error = 'HTTP 404'): void {
    availability.set({ kind: 'unavailable', discoveryUrl: aDiscovery().discoveryUrl, error });
  }

  /** The address the flow will use, as the worker reports it; null while it can report none. */
  function redirectsTo(uri: string, usesIdentityApi = true): void {
    redirectUri = { redirectUri: uri, usesIdentityApi };
  }

  return { fake, federates, federatesNothing, redirectsTo };
}

export type OAuthFake = ReturnType<typeof fakeOAuth>;
