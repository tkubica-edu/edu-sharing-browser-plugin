import { signal } from '@angular/core';
import { vi } from 'vitest';

import { User } from 'ngx-edu-sharing-api';

import { AuthService } from '../../app/services/auth.service';
import { OAuthProvider } from '../../app/services/oauth.service';

/** The repository every fake starts out configured against. */
export const FAKE_REPOSITORY_URL = 'https://repo.example/edu-sharing';

/**
 * `AuthService` as the facts its dependents ask about: which repository is configured, whether there
 * is a session, and whether the panel may do anything at all.
 *
 * `loggedIn` and `authorized` are separate knobs rather than one derived from the other, because the
 * two come apart in the case that matters: a repository with the custom web component enabled brings
 * its own session, so the panel is authorized while there is no login to make. {@link signIn} is for
 * the ordinary case where they move together.
 */
export function fakeAuth(repositoryUrl = FAKE_REPOSITORY_URL) {
  const loggedIn = signal(false);
  const authorized = signal(false);

  const fake = {
    repositoryUrl: signal(repositoryUrl),
    loggedIn,
    authorized,
    username: signal<string | null>(null),
    // The person behind the session, as the repository reports it; null while the profile is still
    // on its way, which is the state the login name stands in for.
    currentUser: signal<User | null>(null),
    // Whether the repository's automatic end is close enough to be pointed out, and how much is
    // left. Two knobs rather than one derived from a clock: what reads them branches on the fact.
    sessionEndingSoon: signal(false),
    sessionRemainingText: signal<string | null>(null),
    error: signal<string | null>(null),
    needsReload: signal(false),
    // What the login card reads to decide what it offers: whether a login applies at all, and which
    // of the two ways in this repository has — the identity provider it publishes, or a password.
    loginRequired: signal(true),
    oauthOffered: signal(false),
    passwordLoginOffered: signal(true),
    oauthProviders: signal<readonly OAuthProvider[]>([]),
    oauthRunning: signal(false),
    login: vi.fn((_username: string, _password: string) => Promise.resolve(true)),
    loginWithOAuth: vi.fn((_provider?: OAuthProvider) => Promise.resolve(true)),
    logout: vi.fn(() => Promise.resolve()),
    revalidate: vi.fn((): Promise<void> => Promise.resolve()),
    applyRepositoryChange: vi.fn(),
  } satisfies Partial<AuthService>;

  /** The session is close to the repository's automatic end, with this much of it left. */
  function endingSoon(remaining = '4 Minuten'): void {
    fake.sessionEndingSoon.set(true);
    fake.sessionRemainingText.set(remaining);
  }

  /** A session of the user's own: both the fact and the permission. */
  function signIn(): void {
    loggedIn.set(true);
    authorized.set(true);
  }

  /**
   * The repository publishes an identity provider, so the card leads through it *instead of* asking
   * for a password — the two are alternatives, not a pair (see AuthService.passwordLoginOffered).
   */
  function offerOAuth(providers: readonly OAuthProvider[] = []): void {
    fake.oauthOffered.set(true);
    fake.passwordLoginOffered.set(false);
    fake.oauthProviders.set(providers);
  }

  /** Authorized by the embedding host instead of by a login — no session to speak of. */
  function authorizeWithoutSession(): void {
    loggedIn.set(false);
    authorized.set(true);
  }

  return { fake, endingSoon, signIn, offerOAuth, authorizeWithoutSession };
}

export type AuthFake = ReturnType<typeof fakeAuth>;
