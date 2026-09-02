import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { APP_CONFIG } from '../config';
import { BrowserExtensionService } from './browser-extension.service';
import { OAuthService } from './oauth.service';
import { provideFake } from '../../testing/provide-fake';
import { BrowserExtensionFake, fakeBrowserExtension } from '../../testing/fakes';

/** The repository the flow is discovered below and whose session the token is traded for. */
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

  /** A repository that publishes an authorization server, as the probe finds it. */
  async function federating(server: Parameters<BrowserExtensionFake['federates']>[0] = {}): Promise<void> {
    extension.federates(server);
    await oauth.probe(REPOSITORY_URL);
  }

  describe('whether the SSO login is offered at all', () => {
    it('is not, before the repository has been asked', () => {
      // Nothing is claimed about a repository that has not answered: the SSO login is a fact about
      // it, and until then the panel behaves as if there were none.
      expect(oauth.available()).toBe(false);
      expect(oauth.availability()).toEqual({ kind: 'unknown' });
    });

    it('is not, where the repository publishes no authorization server', async () => {
      await oauth.probe(REPOSITORY_URL);

      expect(oauth.available()).toBe(false);
      // The ordinary repository, and no error: it says so in the words a failed login would use.
      expect(oauth.availability()).toEqual({
        kind: 'unavailable',
        discoveryUrl: `${REPOSITORY_URL}/.well-known/oauth-authorization-server`,
        error: expect.stringContaining('OAuth-Konfiguration'),
      });
    });

    it('is, where it publishes one', async () => {
      await federating();

      expect(oauth.available()).toBe(true);
      expect(oauth.availability().kind).toBe('available');
    });

    it('asks below the repository, as the panel`s shipped client', async () => {
      await federating();

      expect(extension.fake.oauthDiscover).toHaveBeenCalledWith({
        repositoryUrl: REPOSITORY_URL,
        clientId: APP_CONFIG.oauth.clientId,
        scopes: APP_CONFIG.oauth.scopes,
        registrationId: undefined,
      });
    });

    it('keeps what the server said about itself, for the settings to report', async () => {
      await federating({ issuer: 'https://sso.example/realms/edu', revocable: false, sessionEndable: true });

      const answer = oauth.availability();
      expect(answer.kind === 'available' && answer.server.issuer).toBe('https://sso.example/realms/edu');
      expect(answer.kind === 'available' && answer.server.sessionEndable).toBe(true);
      expect(answer.kind === 'available' && answer.server.revocable).toBe(false);
    });

    it('reports it as running while the repository is being asked', async () => {
      let release = (_answer: never) => undefined as void;
      extension.fake.oauthDiscover.mockImplementation(() => new Promise((_resolve, reject) => (release = reject)));

      const probe = oauth.probe(REPOSITORY_URL);
      expect(oauth.probing()).toBe(true);

      release(new Error('OAUTH_DISCOVERY_FAILED: 404') as never);
      await probe;
      expect(oauth.probing()).toBe(false);
    });

    it('answers for the repository it was asked about, and no other', async () => {
      await federating();

      // The panel is pointed elsewhere, and that repository says nothing: the SSO login goes with it
      // rather than staying on from the previous answer.
      extension.fake.oauthDiscover.mockRejectedValue(new Error('OAUTH_DISCOVERY_FAILED: 404'));
      await oauth.probe('https://other.example/edu-sharing');

      expect(oauth.available()).toBe(false);
    });
  });

  describe('the interactive flow', () => {
    it('refuses to start where the repository federates against nothing, and asks nothing of the worker', async () => {
      await oauth.probe(REPOSITORY_URL);

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome.kind).toBe('failed');
      expect(extension.fake.oauthLogin).not.toHaveBeenCalled();
    });

    it('states the repository, the client and the picked provider in what it asks the worker for', async () => {
      await federating();
      extension.oauthYields('an-access-token');

      await oauth.login(REPOSITORY_URL, { label: 'Uni-Login', registrationId: 'uni' });

      expect(extension.fake.oauthLogin).toHaveBeenCalledWith({
        repositoryUrl: REPOSITORY_URL,
        clientId: APP_CONFIG.oauth.clientId,
        scopes: APP_CONFIG.oauth.scopes,
        registrationId: 'uni',
      });
    });

    it('answers with the token a completed flow produced', async () => {
      await federating();
      extension.oauthYields('an-access-token');

      expect(await oauth.login(REPOSITORY_URL)).toEqual({
        kind: 'token',
        accessToken: 'an-access-token',
      });
    });

    it('reads a flow nobody completed as cancelled rather than as a failure', async () => {
      await federating();
      extension.oauthRefuses('OAUTH_CANCELLED');

      expect(await oauth.login(REPOSITORY_URL)).toEqual({ kind: 'cancelled' });
    });

    it('reads the timeout the same way — nobody answered, and nothing failed', async () => {
      await federating();
      extension.oauthRefuses('OAUTH_TIMEOUT');

      expect(await oauth.login(REPOSITORY_URL)).toEqual({ kind: 'cancelled' });
    });

    it('says which step refused, rather than showing the worker`s code', async () => {
      await federating();
      extension.oauthRefuses('OAUTH_DISCOVERY_FAILED: 404 Not Found');

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome.kind).toBe('failed');
      expect(outcome.kind === 'failed' && outcome.error).not.toContain('OAUTH_');
    });

    it('passes an unrecognised refusal through rather than swallowing it', async () => {
      await federating();
      extension.oauthRefuses('the worker exploded');

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome).toEqual({ kind: 'failed', error: 'the worker exploded' });
    });

    it('reports it as running while the identity provider`s pages are up', async () => {
      await federating();
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
      await federating();
      extension.fake.oauthLogin.mockImplementation(() => new Promise(() => undefined));

      void oauth.login(REPOSITORY_URL);
      const second = await oauth.login(REPOSITORY_URL);

      expect(second).toEqual({ kind: 'cancelled' });
      expect(extension.fake.oauthLogin).toHaveBeenCalledTimes(1);
    });
  });

  describe('the silent renewal', () => {
    it('asks nothing where the repository federates against nothing', async () => {
      await oauth.probe(REPOSITORY_URL);

      expect(await oauth.silentAccessToken(REPOSITORY_URL)).toBeNull();
      expect(extension.fake.oauthSilent).not.toHaveBeenCalled();
    });

    it('answers null where nobody is signed in', async () => {
      await federating();

      expect(await oauth.silentAccessToken(REPOSITORY_URL)).toBeNull();
    });

    it('answers with the token the stored session yielded', async () => {
      await federating();
      extension.oauthResumes('a-renewed-token');

      expect(await oauth.silentAccessToken(REPOSITORY_URL)).toBe('a-renewed-token');
    });

    it('answers null rather than throwing where the worker is unreachable', async () => {
      await federating();
      extension.fake.oauthSilent.mockRejectedValue(new Error('WORKER_UNREACHABLE'));

      expect(await oauth.silentAccessToken(REPOSITORY_URL)).toBeNull();
    });
  });

  describe('reporting what the provider refused', () => {
    it('names an unknown scope, which is what a Doorkeeper provider refuses `offline_access` with', async () => {
      await federating();
      extension.oauthRefuses('OAUTH_REFUSED: invalid_scope');

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome.kind === 'failed' && outcome.error).toContain('Scopes');
    });

    it('names an unregistered redirect address', async () => {
      await federating();
      extension.oauthRefuses('OAUTH_REFUSED: redirect_uri_mismatch');

      const outcome = await oauth.login(REPOSITORY_URL);

      expect(outcome.kind === 'failed' && outcome.error).toContain('Redirect-URI');
    });

    it('names a client the provider does not know, or one registered as confidential', async () => {
      await federating();
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
