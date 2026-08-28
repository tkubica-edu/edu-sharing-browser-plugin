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

  // `applyRepositoryChange()` is deliberately not exercised: it calls `location.reload()`, which jsdom
  // does not implement — and reloading the panel is what the manual checklist covers.
});
