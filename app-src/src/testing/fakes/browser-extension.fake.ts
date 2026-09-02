import { signal } from '@angular/core';
import { vi } from 'vitest';

import {
  AnnouncedPage,
  BrowserExtensionService,
  OAuthRequest,
  OAuthSession,
  SaveNodeResponse,
} from '../../app/services/browser-extension.service';

/**
 * `BrowserExtensionService` with its extension APIs replaced: `storage.local` becomes an in-memory
 * map, and everything that would leave the panel is a spy that does nothing. It is the wrapper 15
 * services depend on, so this fake is what keeps `browser.*` out of the whole test run.
 */
export function fakeBrowserExtension() {
  /** Stands in for `storage.local`, so a `load()` can be given what a previous session wrote. */
  const storage = new Map<string, unknown>();

  // Spied separately and cast at the property below: `storageGet` is generic in its fallback, and a
  // vitest `Mock` erases the type parameter — so this is the one member the `satisfies` check cannot
  // carry. Its signature is repeated here by hand instead.
  const storageGet = vi.fn(
    (key: string, fallback: unknown): Promise<unknown> =>
      Promise.resolve(storage.has(key) ? storage.get(key) : fallback),
  );

  /** What the worker answers a `metadata.saveNode` with — see {@link writes} and {@link refuses}. */
  let saved: SaveNodeResponse = { success: true, result: { success: true } };

  /** What the worker answers the interactive OAuth flow with — see {@link oauthYields}. */
  let oauthLogin: OAuthSession = { success: false, error: 'OAUTH_CANCELLED' };
  /** And the silent one, whose default is the ordinary case of nobody being signed in. */
  let oauthSilent: OAuthSession = { success: true, signedIn: false };

  const fake = {
    available: true,
    announcedPage: signal<AnnouncedPage | null>(null),
    storageGet: storageGet as unknown as BrowserExtensionService['storageGet'],
    storageSet: vi.fn((key: string, value: unknown): Promise<void> => {
      storage.set(key, value);
      return Promise.resolve();
    }),
    navigateTab: vi.fn((): Promise<void> => Promise.resolve()),
    saveNode: vi.fn(
      (_body: Record<string, unknown>, _apiUrl?: string): Promise<SaveNodeResponse> =>
        Promise.resolve(saved),
    ),
    oauthLogin: vi.fn((_request: OAuthRequest): Promise<OAuthSession> => Promise.resolve(oauthLogin)),
    oauthSilent: vi.fn((_request: OAuthRequest): Promise<OAuthSession> => Promise.resolve(oauthSilent)),
    oauthLogout: vi.fn((_request: OAuthRequest): Promise<OAuthSession> => Promise.resolve({ success: true })),
    oauthRedirectUri: vi.fn((_request: OAuthRequest) =>
      Promise.resolve({ redirectUri: 'https://abc.chromiumapp.org/', usesIdentityApi: true }),
    ),
  } satisfies Partial<BrowserExtensionService>;

  /**
   * What the endpoint reports for the next write. Its own verdict, one level in under `result` — the
   * transport succeeded, which is the case every write path is read for.
   */
  function writes(result: SaveNodeResponse['result']): void {
    saved = { success: true, result };
  }

  /** The message never reached a worker: the *transport* failed, and it says nothing about the write. */
  function refuses(error: string): void {
    saved = { success: false, error };
  }

  /** The worker's OAuth flow ends in this token — the completed-flow case. */
  function oauthYields(accessToken: string): void {
    oauthLogin = { success: true, accessToken };
  }

  /** It ends without one instead: a cancellation, or one of the flow's own refusals. */
  function oauthRefuses(error: string): void {
    oauthLogin = { success: false, error };
  }

  /** Somebody is still signed in, so the silent attempt answers with a token. */
  function oauthResumes(accessToken: string): void {
    oauthSilent = { success: true, signedIn: true, accessToken };
  }

  return { fake, storage, storageGet, writes, refuses, oauthYields, oauthRefuses, oauthResumes };
}

export type BrowserExtensionFake = ReturnType<typeof fakeBrowserExtension>;
