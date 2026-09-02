import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';
import { OAuthService } from './oauth.service';
import { provideFake } from '../../testing/provide-fake';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';

/** The repository the flow's redirect address falls back to where the browser provides none. */
const REPOSITORY_URL = 'https://repo.example/edu-sharing';

describe('OAuthService', () => {
  let oauth: OAuthService;
  let extension: BrowserExtensionFake;

  beforeEach(() => {
    extension = fakeBrowserExtension();
    TestBed.configureTestingModule({
      providers: [provideFake(BrowserExtensionService, extension.fake)],
    });
    oauth = TestBed.inject(OAuthService);
  });

  /** A configured client, as a previous session's settings would have left it. */
  async function configure(
    issuer = 'https://sso.example/realms/edu',
    clientId = 'edu-sharing-extension',
  ): Promise<void> {
    extension.storage.set(APP_CONFIG.storageKeys.oauthIssuer, issuer);
    extension.storage.set(APP_CONFIG.storageKeys.oauthClientId, clientId);
    await oauth.load();
  }

  describe('whether the alternative is offered at all', () => {
    it('is not, with nothing configured', async () => {
      await oauth.load();

      expect(oauth.configured()).toBe(false);
    });

    it('is not on an issuer alone — there is no client to name the extension by', async () => {
      extension.storage.set(APP_CONFIG.storageKeys.oauthIssuer, 'https://sso.example/realms/edu');
      await oauth.load();

      expect(oauth.configured()).toBe(false);
    });

    it('is, once both halves of a client are there', async () => {
      await configure();

      expect(oauth.configured()).toBe(true);
    });
  });

  describe('the configured client', () => {
    it('falls back to what the panel ships with for the fields left empty', async () => {
      await configure();

      expect(oauth.scopes()).toBe(APP_CONFIG.oauth.scopes);
      // Empty is not a value here: it is what leaves the redirect address to the browser.
      expect(oauth.redirectUri()).toBe('');
    });

    it('persists a changed field and reports it as changed', async () => {
      await configure();
      await oauth.setScopes('  openid profile  ');

      expect(oauth.scopes()).toBe('openid profile');
      expect(extension.storage.get(APP_CONFIG.storageKeys.oauthScopes)).toBe('openid profile');
      // The issuer, the client and the scopes — the redirect address is still the browser's to pick.
      expect(oauth.changedSettings()).toBe(3);
    });

    it('puts the shipped scopes back in force for an emptied field', async () => {
      await configure();
      await oauth.setScopes('openid');
      await oauth.setScopes('   ');

      expect(oauth.scopes()).toBe(APP_CONFIG.oauth.scopes);
    });
  });

  describe('the interactive flow', () => {
    it('refuses to start without a configured client, and asks nothing of the worker', async () => {
      await oauth.load();

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome.kind).toBe('failed');
      expect(extension.fake.oauthLogin).not.toHaveBeenCalled();
    });

    it('states the whole client and the repository in what it asks the worker for', async () => {
      await configure();
      extension.oauthYields('an-access-token');

      await oauth.login(REPOSITORY_URL, { label: 'Uni-Login', registrationId: 'uni' });

      expect(extension.fake.oauthLogin).toHaveBeenCalledWith({
        issuer: 'https://sso.example/realms/edu',
        clientId: 'edu-sharing-extension',
        scopes: APP_CONFIG.oauth.scopes,
        redirectUri: '',
        repositoryUrl: REPOSITORY_URL,
        registrationId: 'uni',
      });
    });

    it('answers with the token a completed flow produced', async () => {
      await configure();
      extension.oauthYields('an-access-token');

      expect(await oauth.login(REPOSITORY_URL)).toEqual({
        kind: 'token',
        accessToken: 'an-access-token',
      });
    });

    it('reads a flow nobody completed as cancelled rather than as a failure', async () => {
      await configure();
      extension.oauthRefuses('OAUTH_CANCELLED');

      expect(await oauth.login(REPOSITORY_URL)).toEqual({ kind: 'cancelled' });
    });

    it('reads the timeout the same way — nobody answered, and nothing failed', async () => {
      await configure();
      extension.oauthRefuses('OAUTH_TIMEOUT');

      expect(await oauth.login(REPOSITORY_URL)).toEqual({ kind: 'cancelled' });
    });

    it('says which step refused, rather than showing the worker`s code', async () => {
      await configure();
      extension.oauthRefuses('OAUTH_DISCOVERY_FAILED: 404 Not Found');

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome.kind).toBe('failed');
      expect(outcome.kind === 'failed' && outcome.error).toContain('Issuer-URL');
      expect(outcome.kind === 'failed' && outcome.error).not.toContain('OAUTH_');
    });

    it('passes an unrecognised refusal through rather than swallowing it', async () => {
      await configure();
      extension.oauthRefuses('the worker exploded');

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome).toEqual({ kind: 'failed', error: 'the worker exploded' });
    });

    it('reports it as running while the identity provider`s pages are up', async () => {
      await configure();
      let release = (_session: { success: boolean; accessToken?: string }) => undefined as void;
      extension.fake.oauthLogin.mockImplementation(
        () => new Promise((resolve) => (release = resolve)),
      );

      const flow = oauth.login(REPOSITORY_URL);
      expect(oauth.running()).toBe(true);

      release({ success: true, accessToken: 'a-token' });
      await flow;
      expect(oauth.running()).toBe(false);
    });

    it('opens no second window for a second attempt made while the first is up', async () => {
      await configure();
      extension.fake.oauthLogin.mockImplementation(() => new Promise(() => undefined));

      void oauth.login(REPOSITORY_URL);
      const second = await oauth.login(REPOSITORY_URL);

      expect(second).toEqual({ kind: 'cancelled' });
      expect(extension.fake.oauthLogin).toHaveBeenCalledTimes(1);
    });
  });

  describe('the silent renewal', () => {
    it('asks nothing without a configured client', async () => {
      await oauth.load();

      expect(await oauth.silentAccessToken(REPOSITORY_URL)).toBeNull();
      expect(extension.fake.oauthSilent).not.toHaveBeenCalled();
    });

    it('answers null where nobody is signed in', async () => {
      await configure();

      expect(await oauth.silentAccessToken(REPOSITORY_URL)).toBeNull();
    });

    it('answers with the token the stored session yielded', async () => {
      await configure();
      extension.oauthResumes('a-renewed-token');

      expect(await oauth.silentAccessToken(REPOSITORY_URL)).toBe('a-renewed-token');
    });

    it('answers null rather than throwing where the worker is unreachable', async () => {
      await configure();
      extension.fake.oauthSilent.mockRejectedValue(new Error('WORKER_UNREACHABLE'));

      expect(await oauth.silentAccessToken(REPOSITORY_URL)).toBeNull();
    });
  });

  describe('checking the issuer', () => {
    it('asks nothing without a configured client, and says why', async () => {
      await oauth.load();

      const result = await oauth.check(REPOSITORY_URL);

      expect(result.kind).toBe('failed');
      expect(extension.fake.oauthCheckIssuer).not.toHaveBeenCalled();
    });

    it('reports an unsupported scope ahead of everything else about the issuer', async () => {
      await configure();
      extension.fake.oauthCheckIssuer.mockResolvedValue({
        revocable: true,
        scopesSupported: ['openid', 'profile', 'email'],
        unsupportedScopes: ['offline_access'],
      });

      // The one answer that means the flow cannot work, so it outranks a reachable issuer.
      expect(await oauth.check(REPOSITORY_URL)).toEqual({
        kind: 'scopes',
        unsupported: ['offline_access'],
      });
    });

    it('reports a healthy issuer, and whether it can revoke', async () => {
      await configure();
      extension.fake.oauthCheckIssuer.mockResolvedValue({
        revocable: false,
        scopesSupported: ['openid'],
        unsupportedScopes: [],
      });

      expect(await oauth.check(REPOSITORY_URL)).toEqual({
        kind: 'ok',
        revocable: false,
        scopesSupported: ['openid'],
      });
    });

    it('reports an unreachable issuer in the words a failed login uses', async () => {
      await configure();
      extension.fake.oauthCheckIssuer.mockRejectedValue(new Error('OAUTH_DISCOVERY_FAILED: 404'));

      const result = await oauth.check(REPOSITORY_URL);

      expect(result.kind).toBe('failed');
      expect(result.kind === 'failed' && result.error).toContain('Issuer-URL');
    });

    it('keeps the last answer, and lets go of it when the client is edited', async () => {
      await configure();
      extension.fake.oauthCheckIssuer.mockResolvedValue({
        revocable: true,
        scopesSupported: null,
        unsupportedScopes: [],
      });
      await oauth.check(REPOSITORY_URL);
      expect(oauth.checked()).not.toBeNull();

      oauth.clearCheck();

      expect(oauth.checked()).toBeNull();
    });
  });

  describe('reporting what the provider refused', () => {
    it('names an unknown scope, which is what a Doorkeeper provider refuses `offline_access` with', async () => {
      await configure();
      extension.oauthRefuses('OAUTH_REFUSED: invalid_scope');

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome.kind === 'failed' && outcome.error).toContain('Scopes');
    });

    it('names an unregistered redirect address', async () => {
      await configure();
      extension.oauthRefuses('OAUTH_REFUSED: redirect_uri_mismatch');

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome.kind === 'failed' && outcome.error).toContain('Redirect-URI');
    });

    it('names a client the provider does not know, or one registered as confidential', async () => {
      await configure();
      extension.oauthRefuses('OAUTH_TOKEN_FAILED: 401 invalid_client');

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome.kind === 'failed' && outcome.error).toContain('Client-ID');
    });
  });

  describe('the providers the repository advertises', () => {
    it('offers none until it is told of any', () => {
      expect(oauth.providers()).toEqual([]);
    });

    it('takes over what it is told', () => {
      oauth.setProviders([{ label: 'Uni-Login', registrationId: 'uni' }]);

      expect(oauth.providers()).toEqual([{ label: 'Uni-Login', registrationId: 'uni' }]);
    });
  });
});
