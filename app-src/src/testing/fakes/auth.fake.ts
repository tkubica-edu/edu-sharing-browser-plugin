import { signal } from '@angular/core';
import { vi } from 'vitest';

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
    error: signal<string | null>(null),
    needsReload: signal(false),
    // The two the login card reads to decide what it offers: whether a login applies at all, and
    // whether an identity provider is configured to offer beside the credential form.
    loginRequired: signal(true),
    oauthOffered: signal(false),
    oauthProviders: signal<readonly OAuthProvider[]>([]),
    oauthRunning: signal(false),
    login: vi.fn((_username: string, _password: string) => Promise.resolve(true)),
    loginWithOAuth: vi.fn((_provider?: OAuthProvider) => Promise.resolve(true)),
    logout: vi.fn(() => Promise.resolve()),
  } satisfies Partial<AuthService>;

  /** A session of the user's own: both the fact and the permission. */
  function signIn(): void {
    loggedIn.set(true);
    authorized.set(true);
  }

  /** An identity provider is configured, so the login card offers it beside the credential form. */
  function offerOAuth(providers: readonly OAuthProvider[] = []): void {
    fake.oauthOffered.set(true);
    fake.oauthProviders.set(providers);
  }

  /** Authorized by the embedding host instead of by a login — no session to speak of. */
  function authorizeWithoutSession(): void {
    loggedIn.set(false);
    authorized.set(true);
  }

  return { fake, signIn, offerOAuth, authorizeWithoutSession };
}

export type AuthFake = ReturnType<typeof fakeAuth>;
