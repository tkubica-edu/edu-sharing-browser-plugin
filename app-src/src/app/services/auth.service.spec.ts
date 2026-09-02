import { TestBed } from '@angular/core/testing';
import { AuthenticationService, LoginInfo, UserEntry, UserService } from 'ngx-edu-sharing-api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_CONFIG, toApiRootUrl } from '../config';
import { AuthService } from './auth.service';
import { BOOT_ROOT_URL } from '../app.config';
import { BrowserExtensionCustomWebComponentService } from './browser-extension-custom-web-component.service';
import { BrowserExtensionService } from './browser-extension.service';
import { provideFake } from '../../testing/provide-fake';
import {
  AuthenticationFake,
  BrowserExtensionFake,
  UserApiFake,
  WebComponentFake,
  aLoginInfo,
  fakeAuthentication,
  fakeBrowserExtension,
  fakeUserApi,
  fakeWebComponent,
} from '../../testing/fakes';

/** The repository the app was bootstrapped against, as `main.ts` hands it to the library. */
const BOOT_URL = 'https://booted.example/edu-sharing/rest';

/** A person record as `observeCurrentUser` answers with one. */
const A_PERSON = {
  person: { authorityName: 'ada', firstName: 'Ada', lastName: 'Lovelace' },
} as unknown as UserEntry;

describe('AuthService', () => {
  let auth: AuthService;
  let authentication: AuthenticationFake;
  let userApi: UserApiFake;
  let extension: BrowserExtensionFake;
  let webComponent: WebComponentFake;

  beforeEach(() => {
    authentication = fakeAuthentication();
    userApi = fakeUserApi();
    extension = fakeBrowserExtension();
    webComponent = fakeWebComponent();
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOT_ROOT_URL, useValue: BOOT_URL },
        provideFake(AuthenticationService, authentication.fake),
        provideFake(UserService, userApi.fake),
        provideFake(BrowserExtensionService, extension.fake),
        provideFake(BrowserExtensionCustomWebComponentService, webComponent.fake),
      ],
    });
    auth = TestBed.inject(AuthService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A login info that is not a session: guest, or refused. */
  function noSession(overrides: Partial<LoginInfo> = {}): LoginInfo {
    return aLoginInfo({ isValidLogin: false, isGuest: true, authorityName: undefined, ...overrides });
  }

  describe('the repository it is configured against', () => {
    it('starts on the booted one, without the library rest suffix', () => {
      expect(auth.repositoryUrl()).toBe('https://booted.example/edu-sharing');
    });

    it('hands the library back the rootUrl for whatever is configured', () => {
      auth.setRepositoryUrl('https://other.example/edu-sharing');

      expect(auth.apiRootUrl()).toBe(toApiRootUrl('https://other.example/edu-sharing'));
    });

    it('persists a changed base and asks for the reload the library needs', () => {
      auth.setRepositoryUrl('  https://other.example/edu-sharing  ');

      expect(auth.repositoryUrl()).toBe('https://other.example/edu-sharing');
      expect(extension.storage.get(APP_CONFIG.storageKeys.repositoryUrl)).toBe(
        'https://other.example/edu-sharing',
      );
      expect(auth.needsReload()).toBe(true);
    });

    it('asks for no reload for the repository it is already running against', () => {
      auth.setRepositoryUrl('https://booted.example/edu-sharing');

      expect(auth.needsReload()).toBe(false);
    });

    it('writes nothing for an emptied field', () => {
      auth.setRepositoryUrl('   ');

      expect(auth.needsReload()).toBe(false);
      expect(extension.fake.storageSet).not.toHaveBeenCalled();
    });
  });

  describe('the gate every feature is behind', () => {
    it('requires a login for an ordinary repository', () => {
      expect(auth.authorized()).toBe(false);
      expect(auth.loginRequired()).toBe(true);
    });

    it('asks for none where the repository brings its own session', () => {
      webComponent.fake.offeredByRepository.set(true);

      expect(auth.authorized()).toBe(true);
      // Not even the logged-out state is reported: nothing about a login is shown at all.
      expect(auth.loginRequired()).toBe(false);
      expect(auth.loggedIn()).toBe(false);
    });
  });

  describe('init', () => {
    it('takes over the persisted repository and revalidates against it', async () => {
      extension.storage.set(APP_CONFIG.storageKeys.repositoryUrl, 'https://stored.example/edu-sharing');

      await auth.init();

      expect(auth.repositoryUrl()).toBe('https://stored.example/edu-sharing');
      expect(auth.needsReload()).toBe(false);
      expect(auth.loggedIn()).toBe(true);
    });

    it('falls back to the shipped default when nothing was ever configured', async () => {
      await auth.init();

      expect(auth.repositoryUrl()).toBe(APP_CONFIG.defaultRepositoryUrl);
    });
  });

  describe('restoring a session on startup', () => {
    it('takes up a valid session by its cookie, and fetches the person behind it', async () => {
      authentication.answers(aLoginInfo({ authorityName: 'ada' }));
      userApi.answers(A_PERSON);

      await auth.init();

      expect(auth.loggedIn()).toBe(true);
      expect(auth.username()).toBe('ada');
      expect(auth.error()).toBeNull();
      expect(auth.currentUser()).toEqual(A_PERSON.person);
    });

    it('stays logged out for a guest session', async () => {
      authentication.answers(noSession());

      await auth.init();

      expect(auth.loggedIn()).toBe(false);
      expect(auth.username()).toBeNull();
    });

    it('stays logged out for a session the repository calls invalid', async () => {
      authentication.answers(aLoginInfo({ isValidLogin: false }));

      await auth.init();

      expect(auth.loggedIn()).toBe(false);
    });

    it('stays logged out when the repository cannot be reached', async () => {
      authentication.fails(new Error('Failed to fetch'));

      await auth.init();

      expect(auth.loggedIn()).toBe(false);
      // Not reported as a login error: nobody tried to log in.
      expect(auth.error()).toBeNull();
    });

    it('gives up on a repository that never answers', async () => {
      vi.useFakeTimers();
      authentication.silent();

      const restored = auth.init();
      await vi.advanceTimersByTimeAsync(8000);
      await restored;

      expect(auth.loggedIn()).toBe(false);
    });

    it('keeps the login name when the person cannot be fetched', async () => {
      authentication.answers(aLoginInfo({ authorityName: 'ada' }));
      userApi.fails(new Error('403 Forbidden'));

      await auth.init();

      expect(auth.loggedIn()).toBe(true);
      expect(auth.username()).toBe('ada');
      expect(auth.currentUser()).toBeNull();
    });
  });

  describe('revalidate', () => {
    it('asks the repository again rather than answering from what the library holds', async () => {
      await auth.revalidate();

      expect(authentication.fake.forceLoginInfoRefresh).toHaveBeenCalled();
    });

    it('drops a session that is gone — the question a restore leaves half-answered', async () => {
      await auth.init();
      expect(auth.loggedIn()).toBe(true);

      authentication.answers(noSession());
      await auth.revalidate();

      expect(auth.loggedIn()).toBe(false);
      expect(auth.username()).toBeNull();
    });

    it('keeps the session over a hiccup instead of logging the user out', async () => {
      await auth.init();

      authentication.fails(new Error('Failed to fetch'));
      await auth.revalidate();

      expect(auth.loggedIn()).toBe(true);
    });
  });

  describe('login', () => {
    it('takes up a valid non-guest login', async () => {
      authentication.answers(aLoginInfo({ authorityName: 'ada' }));

      expect(await auth.login('ada', 'secret')).toBe(true);
      expect(auth.loggedIn()).toBe(true);
      expect(auth.username()).toBe('ada');
      expect(auth.error()).toBeNull();
    });

    it('falls back to the name that was typed when the answer carries none', async () => {
      authentication.answers(aLoginInfo({ authorityName: undefined }));

      await auth.login('ada', 'secret');

      expect(auth.username()).toBe('ada');
    });

    it('refuses a guest login as invalid credentials', async () => {
      authentication.answers(noSession());

      expect(await auth.login('ada', 'wrong')).toBe(false);
      expect(auth.loggedIn()).toBe(false);
      expect(auth.error()).toBe('Ungültige Anmeldedaten.');
    });

    it('reads a status of 0 as the repository not being reachable', async () => {
      authentication.fails({ status: 0 });

      expect(await auth.login('ada', 'secret')).toBe(false);
      expect(auth.error()).toContain('CORS/Netzwerk');
    });

    it('reads 401 and 403 as invalid credentials', async () => {
      authentication.fails({ status: 401 });
      await auth.login('ada', 'wrong');
      expect(auth.error()).toBe('Ungültige Anmeldedaten.');

      authentication.fails({ status: 403 });
      await auth.login('ada', 'wrong');
      expect(auth.error()).toBe('Ungültige Anmeldedaten.');
    });

    it('passes any other failure on in the words it came with', async () => {
      authentication.fails({ status: 500, message: 'Internal Server Error' });

      await auth.login('ada', 'secret');

      expect(auth.error()).toBe('Internal Server Error');
    });

    it('says something even for a failure that says nothing', async () => {
      authentication.fails(undefined);

      await auth.login('ada', 'secret');

      expect(auth.error()).toBe('Login fehlgeschlagen.');
    });

    it('clears the previous failure before trying again', async () => {
      authentication.fails({ status: 401 });
      await auth.login('ada', 'wrong');

      authentication.answers(aLoginInfo({ authorityName: 'ada' }));
      await auth.login('ada', 'secret');

      expect(auth.error()).toBeNull();
    });
  });

  describe('logout', () => {
    it('drops the local session', async () => {
      await auth.init();

      await auth.logout();

      expect(auth.loggedIn()).toBe(false);
      expect(auth.username()).toBeNull();
      expect(auth.currentUser()).toBeNull();
      expect(auth.error()).toBeNull();
    });

    it('drops it even when the repository refuses to be told', async () => {
      await auth.init();
      authentication.fake.logout.mockImplementation(() => {
        throw new Error('502 Bad Gateway');
      });

      await auth.logout();

      expect(auth.loggedIn()).toBe(false);
    });
  });

  describe('signing in through an identity provider', () => {
    /** The repository publishes an authorization server of its own — see OAuthService.probe. */
    function configureOAuth(): void {
      extension.federates();
    }

    it('is not offered where the repository publishes no authorization server', async () => {
      await auth.init();

      expect(auth.oauthOffered()).toBe(false);
      // Which is what leaves the credential form as the way in.
      expect(auth.passwordLoginOffered()).toBe(true);
    });

    it('is offered where it publishes one, and is then the only way in', async () => {
      configureOAuth();

      await auth.init();

      expect(auth.oauthOffered()).toBe(true);
      // The repository has named the identity its users are known by; a password would go around it.
      expect(auth.passwordLoginOffered()).toBe(false);
    });

    it('refuses a credential login outright where the repository federates', async () => {
      configureOAuth();
      await auth.init();

      expect(await auth.login('ada', 'a-password')).toBe(false);

      expect(authentication.fake.login).not.toHaveBeenCalled();
      expect(auth.error()).toContain('SSO');
    });

    it('is offered where the embedding host brings the session too', async () => {
      configureOAuth();
      await auth.init();

      webComponent.fake.offeredByRepository.set(true);

      // The card is reachable in that state, and which way in it offers is the repository's answer
      // either way — not something the embedding host has anything to say about.
      expect(auth.loginRequired()).toBe(false);
      expect(auth.oauthOffered()).toBe(true);
    });

    it('trades the access token for a repository session', async () => {
      configureOAuth();
      authentication.answers(noSession());
      authentication.answersToken(aLoginInfo({ authorityName: 'ada' }));
      userApi.answers(A_PERSON);
      await auth.init();
      extension.oauthYields('an-access-token');

      expect(await auth.loginWithOAuth()).toBe(true);

      // The token is presented as a bearer token; the repository answers with the session cookie.
      expect(authentication.fake.loginToken).toHaveBeenCalledWith('an-access-token');
      expect(auth.loggedIn()).toBe(true);
      expect(auth.username()).toBe('ada');
      expect(auth.currentUser()).toEqual(A_PERSON.person);
      expect(auth.error()).toBeNull();
    });

    it('names the provider the login screen picked', async () => {
      configureOAuth();
      await auth.init();
      extension.oauthYields('an-access-token');

      await auth.loginWithOAuth({ label: 'Uni-Login', registrationId: 'uni' });

      expect(extension.fake.oauthLogin).toHaveBeenCalledWith(
        expect.objectContaining({ registrationId: 'uni', repositoryUrl: auth.repositoryUrl() }),
      );
    });

    it('reports a repository that will not take the token', async () => {
      configureOAuth();
      authentication.answers(noSession());
      authentication.answersToken(noSession());
      await auth.init();
      extension.oauthYields('an-access-token');

      expect(await auth.loginWithOAuth()).toBe(false);

      expect(auth.loggedIn()).toBe(false);
      expect(auth.error()).toContain('SSO');
    });

    it('leaves the screen as it was for a flow nobody completed', async () => {
      configureOAuth();
      authentication.answers(noSession());
      await auth.init();
      extension.oauthRefuses('OAUTH_CANCELLED');

      expect(await auth.loginWithOAuth()).toBe(false);

      // A cancellation is an answer, not a failure: nothing is reported on the login screen.
      expect(auth.error()).toBeNull();
      expect(authentication.fake.loginToken).not.toHaveBeenCalled();
    });

    it('reports a flow that failed', async () => {
      configureOAuth();
      authentication.answers(noSession());
      await auth.init();
      extension.oauthRefuses('OAUTH_DISCOVERY_FAILED: 404');

      expect(await auth.loginWithOAuth()).toBe(false);

      // The worker's code as the sentence it stands for, not as the code itself.
      expect(auth.error()).toContain('OAuth-Konfiguration');
    });

    it('takes over the providers the repository advertises', async () => {
      configureOAuth();
      authentication.answers(
        aLoginInfo({
          authorityName: 'ada',
          oauthEntries: [
            { registrationId: 'uni', name: 'Uni-Login' },
            // No registration id: nothing the authorization request could pass on, so it is dropped.
            { name: 'Namenlos' },
          ],
        }),
      );

      await auth.init();

      expect(auth.oauthProviders()).toEqual([{ label: 'Uni-Login', registrationId: 'uni' }]);
    });

    it('falls back to the registration id where the repository names no provider', async () => {
      configureOAuth();
      authentication.answers(aLoginInfo({ oauthEntries: [{ registrationId: 'uni' }] }));

      await auth.init();

      expect(auth.oauthProviders()).toEqual([{ label: 'uni', registrationId: 'uni' }]);
    });
  });

  describe('resuming an OAuth session on startup', () => {
    function configureOAuth(): void {
      extension.federates();
    }

    it('puts the session back from the stored refresh token, without asking', async () => {
      configureOAuth();
      authentication.answers(noSession());
      authentication.answersToken(aLoginInfo({ authorityName: 'ada' }));
      extension.oauthResumes('a-renewed-token');

      await auth.init();

      expect(auth.loggedIn()).toBe(true);
      expect(auth.username()).toBe('ada');
      expect(extension.fake.oauthLogin).not.toHaveBeenCalled();
    });

    it('does not ask where the cookie already carried a session', async () => {
      configureOAuth();
      authentication.answers(aLoginInfo({ authorityName: 'ada' }));

      await auth.init();

      expect(auth.loggedIn()).toBe(true);
      expect(extension.fake.oauthSilent).not.toHaveBeenCalled();
    });

    it('reports nothing where there is nothing to resume from', async () => {
      configureOAuth();
      authentication.answers(noSession());

      await auth.init();

      expect(auth.loggedIn()).toBe(false);
      // Nobody asked for a login, so a renewal that found none says nothing on the screen.
      expect(auth.error()).toBeNull();
    });

    it('stays quiet about a stored session the repository refuses', async () => {
      configureOAuth();
      authentication.answers(noSession());
      authentication.refusesToken({ status: 401 });
      extension.oauthResumes('a-spent-token');

      await auth.init();

      expect(auth.loggedIn()).toBe(false);
      expect(auth.error()).toBeNull();
    });

    it('asks nothing at all where the repository federates against nothing', async () => {
      authentication.answers(noSession());

      await auth.init();

      expect(extension.fake.oauthSilent).not.toHaveBeenCalled();
    });
  });

  describe('logging out of both', () => {
    it('drops the OAuth session with the repository one', async () => {
      extension.federates();
      await auth.init();

      await auth.logout();

      // Leaving the refresh token would sign the user straight back in on the next boot.
      expect(extension.fake.oauthLogout).toHaveBeenCalled();
      expect(auth.loggedIn()).toBe(false);
    });

    it('asks nothing of the worker where the repository federates against nothing', async () => {
      await auth.init();

      await auth.logout();

      expect(extension.fake.oauthLogout).not.toHaveBeenCalled();
    });
  });

  // `applyRepositoryChange()` is deliberately not exercised: it calls `location.reload()`, which jsdom
  // does not implement — and reloading the panel is what the manual checklist covers.
});
